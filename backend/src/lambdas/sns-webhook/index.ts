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
  TransactWriteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { transactWriteWithRetry } from "../../utils/transactWriteWithRetry.js";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { createCircuitBreaker } from "../../utils/circuitBreaker.js";
import { CircuitOpenError } from "../../utils/errors.js";
import { computeReceiptHash } from "../../utils/receiptHash.js";
import { fuzzyMatchReceipt } from "../../utils/fuzzyMatch.js";
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

// ─── Circuit Breakers ─────────────────────────────────────────────────────────
// Module-level instances persist across warm invocations in the same Lambda
// container. Cold starts reset state to CLOSED (safe default).
const textractBreaker = createCircuitBreaker({
  name: "textract",
  failureThreshold: 5,
  cooldownMs: 30_000,
});
const bedrockBreaker = createCircuitBreaker({
  name: "bedrock",
  failureThreshold: 5,
  cooldownMs: 30_000,
});

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
  s3Key:        string;
  lineItems:    string[];
  aiEnrichment: AiEnrichment;
  processingMs: number;
  now:          string;
}): Promise<void> {
  const { expenseId, scanId, userId, jobId, extracted, s3Key, lineItems, aiEnrichment, processingMs, now } = opts;

  // Atomically update scan record and back-fill parent expense in one transaction.
  // Condition: scan must still be "processing" — prevents duplicate completion
  // from Textract retry notifications.
  await transactWriteWithRetry(ddb, {
    TransactItems: [
      // 5a. Update the scan record → completed
      {
        Update: {
          TableName:           TABLE,
          Key:                 { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
          UpdateExpression:    `SET #status = :status,
                                   extractedData  = :data,
                                   aiEnrichment   = :ai,
                                   textractJobId  = :jobId,
                                   processingMs   = :ms,
                                   updatedAt      = :now`,
          ConditionExpression: `#status = :processing`,
          ExpressionAttributeNames:  { "#status": "status" },
          ExpressionAttributeValues: {
            ":status":     "completed",
            ":processing": "processing",
            ":data":       { ...extracted, lineItems: lineItems.map(d => ({ description: d, total: 0 })) },
            ":ai":         aiEnrichment,
            ":jobId":      jobId,
            ":ms":         processingMs,
            ":now":        now,
          },
        },
      },
      // 5b. Back-fill the parent expense record (only if fields not already set by user)
      {
        Update: {
          TableName:           TABLE,
          Key:                 { pk: `USER#${userId}`, sk: `EXPENSE#${expenseId}` },
          UpdateExpression:    `SET scanId                           = :sid,
                                   receiptKey  = :rkey,
                                   merchant    = if_not_exists(merchant,  :merchant),
                                   amount      = if_not_exists(amount,    :amount),
                                   #date       = if_not_exists(#date,     :date),
                                   category    = if_not_exists(category,  :category),
                                   receiptHash = :hash,
                                   updatedAt   = :now`,
          ExpressionAttributeNames:  { "#date": "date" },
          ExpressionAttributeValues: {
            ":sid":      scanId,
            ":rkey":     s3Key,
            ":merchant": extracted.merchant ?? "Unknown",
            ":amount":   extracted.total    ?? 0,
            ":date":     extracted.date     ?? now.slice(0, 10),
            ":category": aiEnrichment.category,
            ":hash":     computeReceiptHash(
                           String(extracted.merchant?.toString() ?? "Unknown"),
                           String(extracted.date ?? now.slice(0, 10)).slice(0, 10),
                           Number(extracted.total)    ?? 0,
                         ),
            ":now":      now,
          },
        },
      },
    ],
  });
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

async function writeScanPendingManualReview(expenseId: string, scanId: string): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName:        TABLE,
      Key:              { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames:  { "#status": "status" },
      ExpressionAttributeValues: { ":status": "pending_manual_review" },
    })
  );
}

// ─── Section 6: Duplicate Detection ─────────────────────────────────────────────

interface DuplicateCheckResult {
  isDuplicate: boolean;
  similarity: "exact" | "fuzzy" | "none";
  existingExpenseId?: string;
  merchantDistance: number;
  amountDifference: number;
}

async function checkForDuplicate(opts: {
  merchant: string;
  date: string;
  amount: number;
  userId: string;
}): Promise<DuplicateCheckResult> {
  const { merchant, date, amount, userId } = opts;

  // Compute deterministic hash from normalized fields
  const receiptHash = computeReceiptHash(merchant, date, amount);
  logger.appendKeys({ receiptHash });

  // Query GSI for existing expense with same hash
  // Gracefully handle environments where the GSI doesn't exist yet (e.g., local dev/testing)
  let result;
  try {
    result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "ReceiptHashIndex",
      KeyConditionExpression: "receiptHash = :hash",
      ExpressionAttributeValues: {
        ":hash": receiptHash,
      },
      Limit: 1,
    }));
  } catch (e: any) {
    if (e.name === "ResourceNotFoundException" || e.message?.includes("Index not found")) {
      logger.warn("ReceiptHashIndex GSI not available — skipping duplicate check", { error: e.message });
      return { isDuplicate: false, similarity: "none", merchantDistance: 0, amountDifference: 0 };
    }
    throw e;
  }

  const existing = result.Items?.[0];
  if (!existing) {
    return { isDuplicate: false, similarity: "none", merchantDistance: 0, amountDifference: 0 };
  }

  // Fuzzy match to determine similarity level
  const match = fuzzyMatchReceipt(
    merchant,
    String(existing.merchant ?? ""),
    amount,
    Number(existing.amount ?? 0),
  );

  logger.info("Duplicate check result", {
    existingExpenseId: existing.expenseId,
    similarity: match.similarity,
    merchantDistance: match.merchantDistance,
    amountDifference: match.amountDifference,
  });

  return {
    isDuplicate: match.isDuplicate,
    similarity: match.similarity,
    existingExpenseId: existing.expenseId,
    merchantDistance: match.merchantDistance,
    amountDifference: match.amountDifference,
  };
}

// ─── Section 7: EventBridge notification ─────────────────────────────────────

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

async function emitDuplicateDetected(opts: {
  userId: string;
  expenseId: string;
  scanId: string;
  extracted: Extracted;
  aiEnrichment: AiEnrichment;
  processingMs: number;
  existingExpenseId: string;
  similarity: "exact" | "fuzzy" | "none";
  receiptHash: string;
}): Promise<void> {
  const { userId, expenseId, scanId, extracted, aiEnrichment, processingMs, existingExpenseId, similarity, receiptHash } = opts;

  await eb.send(
    new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS,
        Source:       "costscrunch.receipts",
        DetailType:   "DuplicateReceiptDetected",
        Detail:       JSON.stringify({
          userId,
          expenseId,
          scanId,
          existingExpenseId,
          similarity,
          receiptHash,
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
    const s3Key = message.DocumentLocation.S3ObjectName;
    const userId = s3Key.split("/")[1]; // receipts/{userId}/…

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

      let docs: any[];
      try {
        docs = await textractBreaker.execute(() => fetchTextractDocs(jobId));
      } catch (e) {
        textractSub.close();
        if (e instanceof CircuitOpenError) {
          logger.warn("Textract circuit open — queueing for manual review", { error: e.message });
          metrics.addMetric("TextractCircuitOpen", MetricUnit.Count, 1);
          await writeScanPendingManualReview(expenseId, scanId);
          continue;
        }
        throw e; // unexpected error → outer catch → writeScanFailed
      }
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
        aiEnrichment = await bedrockBreaker.execute(() => enrichWithClaude(extracted, lineItems));
        metrics.addMetric("ClaudeEnrichmentSuccess", MetricUnit.Count, 1);
      } catch (e) {
        if (e instanceof CircuitOpenError) {
          logger.warn("Bedrock circuit open — using keyword fallback", { error: e.message });
          metrics.addMetric("BedrockCircuitOpen", MetricUnit.Count, 1);
        } else {
          logger.warn("Claude enrichment failed — using keyword fallback", { error: e });
          metrics.addMetric("ClaudeEnrichmentFallback", MetricUnit.Count, 1);
        }
      }
      bedrockSub.close();

      const now          = new Date().toISOString();
      const processingMs = Date.now() - startMs;

      // ── Step 3: Check for duplicate receipts ─────────────────────────────
      const duplicateCheck = await checkForDuplicate({
        merchant: String(extracted.merchant ?? ""),
        date:     String(extracted.date     ?? now.slice(0, 10)),
        amount:   Number(extracted.total    ?? 0),
        userId,
      });

      if (duplicateCheck.isDuplicate) {
        // Emit duplicate detection event instead of completing scan
        await emitDuplicateDetected({
          userId,
          expenseId,
          scanId,
          extracted,
          aiEnrichment,
          processingMs,
          existingExpenseId: duplicateCheck.existingExpenseId!,
          similarity: duplicateCheck.similarity,
          receiptHash: computeReceiptHash(
            String(extracted.merchant ?? ""),
            String(extracted.date ?? now.slice(0, 10)),
            Number(extracted.total ?? 0),
          ),
        });

        metrics.addMetric("DuplicateDetected", MetricUnit.Count, 1);
        logger.info("Duplicate receipt detected", {
          existingExpenseId: duplicateCheck.existingExpenseId,
          similarity: duplicateCheck.similarity,
        });
        continue;
      }

      // ── Step 4: Persist results to DynamoDB ────────────────────────────────
      try {
        await writeScanCompleted({
          expenseId, scanId, userId, jobId,
          extracted, s3Key, lineItems, aiEnrichment,
          processingMs, now,
        });
        logger.info("DynamoDB updated", { status: "completed", processingMs });
      } catch (e: any) {
        // TransactionCanceledException with ConditionalCheckFailed means the
        // scan was already processed (duplicate Textract notification) — safe
        // to ignore.  Any other error propagates.
        const reasons = e.CancellationReasons as Array<{ Code?: string }> | undefined;
        if (
          e.name === "TransactionCanceledException" &&
          reasons?.some(r => r.Code === "ConditionalCheckFailed")
        ) {
          logger.info("Scan already completed — skipping duplicate write", {
            expenseId, scanId,
          });
          return; // don't re-emit EventBridge
        }
        throw e;
      }

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