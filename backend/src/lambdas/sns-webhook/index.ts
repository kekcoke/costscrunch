// ─── CostsCrunch — SNS Webhook Lambda ────────────────────────────────────────
// Triggered by: SNS topic ← Textract job completion notification
// Responsibility: retrieve Textract results, enrich with Claude, write DynamoDB,
//                 emit ReceiptScanCompleted to EventBridge.
//
// Pipeline position: Textract (async) → SNS → [this file] → DDB + EventBridge
//
// Why this exists:
//   index.ts fires StartExpenseAnalysisCommand and returns immediately.
//   Textract can take 10–90 s; keeping that wait inside a synchronous Lambda
//   wastes execution time and risks the 15-min Lambda timeout on busy accounts.
//   Instead, Textract publishes a JSON payload to an SNS topic when the job
//   finishes. SNS invokes this Lambda instantly — no polling required.

import {
  TextractClient,
  GetExpenseAnalysisCommand,
  type ExpenseDocument,
} from "@aws-sdk/client-textract";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import type { SNSEvent } from "aws-lambda";

// ─── Clients ──────────────────────────────────────────────────────────────────
const textract = new TextractClient({});
const bedrock  = new BedrockRuntimeClient({ region: "us-east-1" });
const ddb      = createDynamoDBDocClient();
const eb       = new EventBridgeClient({});

const TABLE         = process.env.TABLE_NAME_MAIN!;
const EVENT_BUS     = process.env.EVENT_BUS_NAME!;
const BEDROCK_MODEL = "anthropic.claude-haiku-4-5-20251001-v1:0";

const logger  = new Logger({ serviceName: "receipts-sns-webhook" });
const tracer  = new Tracer({ serviceName: "receipts-sns-webhook" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "receipts-sns-webhook" });

// ─── SNS payload shape emitted by Textract ────────────────────────────────────
interface TextractSnsMessage {
  JobId:        string;
  Status:       "SUCCEEDED" | "FAILED";
  JobTag:       string;    // set by index.ts as "{expenseId}/{scanId}"
  DocumentLocation: {
    S3ObjectName: string;
    S3Bucket:     string;
  };
  Message?: string;
}

// ─── Section 1: Textract result retrieval ─────────────────────────────────────
// GetExpenseAnalysis returns instantly here — the job is already complete when
// SNS fires. No polling loop needed.

async function fetchTextractDocs(jobId: string): Promise<ExpenseDocument[]> {
  const result = await textract.send(
    new GetExpenseAnalysisCommand({ JobId: jobId })
  );
  return result.ExpenseDocuments ?? [];
}

// ─── Section 2: Expense document parsing ─────────────────────────────────────

type Extracted = Record<string, string | number | undefined>;

function parseExpenseDocuments(docs: ExpenseDocument[]): {
  extracted: Extracted;
  lineItems: string[];
} {
  const extracted: Extracted = {};
  const lineItems: string[]  = [];

  for (const doc of docs) {
    for (const field of doc.SummaryFields ?? []) {
      const type  = field.Type?.Text?.toUpperCase();
      const value = field.ValueDetection?.Text;
      if (!type || !value) continue;

      switch (type) {
        case "VENDOR_NAME":          extracted.merchant        = value; break;
        case "TOTAL":                extracted.total           = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "SUBTOTAL":             extracted.subtotal        = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "TAX":                  extracted.tax             = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "GRATUITY":             extracted.tip             = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "INVOICE_RECEIPT_DATE": extracted.date            = value; break;
        case "RECEIVER_ADDRESS":     extracted.merchantAddress = value; break;
        // PAYMENT_TERMS intentionally ignored
      }
    }

    for (const group of doc.LineItemGroups ?? []) {
      for (const item of group.LineItems ?? []) {
        const desc = item.LineItemExpenseFields
          ?.find(f => f.Type?.Text === "ITEM")
          ?.ValueDetection?.Text;
        if (desc) lineItems.push(desc);
      }
    }
  }

  return { extracted, lineItems };
}

// ─── Section 3: Category keyword fallback ────────────────────────────────────
// Used when Claude/Bedrock is unavailable or throttled.

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Travel:     ["airline", "hotel", "marriott", "hilton", "airbnb", "uber", "lyft", "taxi", "rental car", "amtrak", "delta", "united", "southwest"],
  Meals:      ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "pizza", "sushi", "bar & grill", "bistro", "kitchen", "eatery", "food"],
  Groceries:  ["grocery", "supermarket", "whole foods", "trader joe", "kroger", "safeway", "costco", "walmart"],
  Software:   ["aws", "github", "adobe", "microsoft", "google workspace", "slack", "zoom", "figma", "notion", "atlassian"],
  Office:     ["staples", "office depot", "fedex", "ups", "usps", "printing"],
  Equipment:  ["apple", "best buy", "dell", "hp", "logitech", "amazon"],
};

function guessCategory(
  merchant: string,
  lineItems: string[]
): { category: string; confidence: number } {
  const text = [merchant, ...lineItems].join(" ");
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    // \b ensures we only match whole words. 'i' makes it case-insensitive.
    if (keywords.some(kw => new RegExp(`\\b${kw}\\b`, "i").test(text))) {
      return { category, confidence: 85 };
    }
  }
  return { category: "Other", confidence: 50 };
}

// ─── Section 4: Claude AI enrichment ─────────────────────────────────────────

interface AiEnrichment {
  category:      string;
  confidence:    number;
  suggestedTags?: string[];
  policyFlags?:  string[];
}

async function enrichWithClaude(
  extracted: Extracted,
  lineItems: string[]
): Promise<AiEnrichment> {
  const prompt = `You are an expense categorization AI. Given this receipt data, return a JSON object with these fields only:
- category: one of [Travel, Meals, Groceries, Software, Office, Equipment, Other]
- confidence: integer 0-100
- suggestedTags: array of 1-3 lowercase strings
- policyFlags: array of strings if anything seems unusual (e.g. "high amount", "entertainment", "luxury item") or empty array

Receipt data:
Merchant: ${extracted.merchant ?? "Unknown"}
Total: ${extracted.total ?? "Unknown"}
Line items: ${lineItems.slice(0, 10).join(", ") || "None"}

Respond with valid JSON only. No explanation.`;

  const response = await bedrock.send(
    new InvokeModelCommand({
      modelId:     BEDROCK_MODEL,
      contentType: "application/json",
      accept:      "application/json",
      body:        JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens:        256,
        messages:          [{ role: "user", content: prompt }],
      }),
    })
  );

  const text = JSON.parse(new TextDecoder().decode(response.body)).content[0].text as string;
  return JSON.parse(text) as AiEnrichment;
}

// ─── Section 5: DynamoDB writes ───────────────────────────────────────────────

async function writeScanCompleted(opts: {
  expenseId:    string;
  scanId:       string;
  userId:       string;
  jobId:        string;
  extracted:    Extracted;
  lineItems:    string[];
  aiEnrichment: AiEnrichment;
  processingMs: number;
  now:          string;
}): Promise<void> {
  const { expenseId, scanId, userId, jobId, extracted, lineItems, aiEnrichment, processingMs, now } = opts;

  // 5a. Update the scan record → completed
  await ddb.send(
    new UpdateCommand({
      TableName:        TABLE,
      Key:              { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
      UpdateExpression: `SET #status = :status,
                             extractedData  = :data,
                             aiEnrichment   = :ai,
                             textractJobId  = :jobId,
                             processingMs   = :ms,
                             updatedAt      = :now`,
      ExpressionAttributeNames:  { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "completed",
        ":data":   { ...extracted, lineItems: lineItems.map(d => ({ description: d, total: 0 })) },
        ":ai":     aiEnrichment,
        ":jobId":  jobId,
        ":ms":     processingMs,
        ":now":    now,
      },
    })
  );

  // 5b. Back-fill the parent expense record (only if fields not already set by user)
  await ddb.send(
    new UpdateCommand({
      TableName:        TABLE,
      Key:              { pk: `USER#${userId}`, sk: `EXPENSE#${expenseId}` },
      UpdateExpression: `SET scanId                           = :sid,
                             merchant    = if_not_exists(merchant,  :merchant),
                             amount      = if_not_exists(amount,    :amount),
                             #date       = if_not_exists(#date,     :date),
                             category    = if_not_exists(category,  :category),
                             updatedAt   = :now`,
      ExpressionAttributeNames:  { "#date": "date" },
      ExpressionAttributeValues: {
        ":sid":      scanId,
        ":merchant": extracted.merchant ?? "Unknown",
        ":amount":   extracted.total    ?? 0,
        ":date":     extracted.date     ?? now.slice(0, 10),
        ":category": aiEnrichment.category,
        ":now":      now,
      },
    })
  );
}

async function writeScanFailed(expenseId: string, scanId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName:        TABLE,
      Key:              { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames:  { "#status": "status" },
      ExpressionAttributeValues: { ":status": "failed" },
    })
  );
}

// ─── Section 6: EventBridge notification ─────────────────────────────────────

async function emitScanCompleted(opts: {
  userId:       string;
  expenseId:    string;
  scanId:       string;
  extracted:    Extracted;
  aiEnrichment: AiEnrichment;
  processingMs: number;
}): Promise<void> {
  const { userId, expenseId, scanId, extracted, aiEnrichment, processingMs } = opts;

  await eb.send(
    new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS,
        Source:       "costscrunch.receipts",
        DetailType:   "ReceiptScanCompleted",
        Detail:       JSON.stringify({
          userId,
          expenseId,
          scanId,
          merchant:     extracted.merchant,
          amount:       extracted.total,
          category:     aiEnrichment.category,
          confidence:   aiEnrichment.confidence,
          processingMs,
        }),
      }],
    })
  );
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withErrorHandler(async (event: SNSEvent): Promise<void> => {
  for (const snsRecord of event.Records) {
    const startMs = Date.now();

    // ── Parse the SNS message from Textract ──────────────────────────────────
    const message = JSON.parse(snsRecord.Sns.Message) as TextractSnsMessage;
    const { JobId: jobId, Status: status, JobTag: jobTag } = message;

    // JobTag was set by index.ts as "{expenseId}/{scanId}"
    const [expenseId, scanId] = jobTag.split("/");
    const userId = message.DocumentLocation.S3ObjectName.split("/")[1]; // receipts/{userId}/…

    tracer.putAnnotation("receiptId", expenseId);

    logger.appendKeys({ jobId, expenseId, scanId, userId });
    logger.info("Received Textract completion notification", { status });

    // ── Handle Textract-side failures reported via SNS ────────────────────────
    if (status === "FAILED") {
      logger.error("Textract job failed", { message: message.Message });
      metrics.addMetric("TextractJobFailed", MetricUnit.Count, 1);
      await writeScanFailed(expenseId, scanId);
      continue;
    }

    try {
      // ── Step 1: Fetch completed Textract results (instant — job is done) ───
      const segment     = tracer.getSegment()!;
      const textractSub = segment.addNewSubsegment("fetchTextractResults");
      const docs        = await fetchTextractDocs(jobId);
      textractSub.close();

      const { extracted, lineItems } = parseExpenseDocuments(docs);
      logger.info("Textract results parsed", {
        merchant:      extracted.merchant,
        lineItemCount: lineItems.length,
      });

      // ── Step 2: AI enrichment — Claude with keyword fallback ───────────────
      const bedrockSub  = segment.addNewSubsegment("claudeEnrichment");
      bedrockSub.addAnnotation("stage", "categorize");
      let aiEnrichment: AiEnrichment = guessCategory(String(extracted.merchant ?? ""), lineItems);

      try {
        aiEnrichment = await enrichWithClaude(extracted, lineItems);
        metrics.addMetric("ClaudeEnrichmentSuccess", MetricUnit.Count, 1);
      } catch (e) {
        logger.warn("Claude enrichment failed — using keyword fallback", { error: e });
        metrics.addMetric("ClaudeEnrichmentFallback", MetricUnit.Count, 1);
      }
      bedrockSub.close();

      const now          = new Date().toISOString();
      const processingMs = Date.now() - startMs;

      // ── Step 3: Persist results to DynamoDB ────────────────────────────────
      await writeScanCompleted({
        expenseId, scanId, userId, jobId,
        extracted, lineItems, aiEnrichment,
        processingMs, now,
      });
      logger.info("DynamoDB updated", { status: "completed", processingMs });

      // ── Step 4: Emit EventBridge event (triggers ws-notifier.ts) ──────────
      await emitScanCompleted({
        userId, expenseId, scanId,
        extracted, aiEnrichment, processingMs,
      });

      metrics.addMetric("ScanCompleted",      MetricUnit.Count,        1);
      metrics.addMetric("ScanProcessingTime", MetricUnit.Milliseconds, processingMs);
      metrics.addMetric("ScanConfidence",     MetricUnit.NoUnit,       aiEnrichment.confidence);
      logger.info("SNS webhook pipeline complete", { processingMs });

    } catch (error) {
      logger.error("SNS webhook pipeline failed", { error });
      metrics.addMetric("ScanFailed", MetricUnit.Count, 1);
      await writeScanFailed(expenseId, scanId);
      throw error; // re-throw → Lambda DLQ / retry
    }
  }
});