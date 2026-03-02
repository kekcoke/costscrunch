// ─── CostsCrunch — Receipt Scan Lambda ─────────────────────────────────────────
// Triggered by S3 PUT events on receipts/ prefix
// Pipeline: S3 → Textract → Claude (Bedrock) → DynamoDB update → EventBridge

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
  TextractClient,
  StartExpenseAnalysisCommand,
  GetExpenseAnalysisCommand,
  type ExpenseDocument,
} from "@aws-sdk/client-textract";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { S3Event } from "aws-lambda";
import { ulid } from "ulid";
import type { ScanResult } from "../shared/models/types";

// ─── Clients ──────────────────────────────────────────────────────────────────
const s3 = new S3Client({});
const textract = new TextractClient({});
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eb = new EventBridgeClient({});

const TABLE = process.env.TABLE_NAME!;
const EVENT_BUS = process.env.EVENT_BUS_NAME!;
const BEDROCK_MODEL = "anthropic.claude-3-haiku-20240307-v1:0";

const logger = new Logger({ serviceName: "receipts" });
const tracer = new Tracer({ serviceName: "receipts" });
const metrics = new Metrics({ namespace: "Costscrunch", serviceName: "receipts" });

// ─── Category mapping ─────────────────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Travel: ["airline", "hotel", "marriott", "hilton", "airbnb", "uber", "lyft", "taxi", "rental car", "amtrak", "delta", "united", "southwest"],
  Meals: ["restaurant", "cafe", "coffee", "starbucks", "mcdonald", "pizza", "sushi", "bar & grill", "bistro", "kitchen", "eatery", "food"],
  Groceries: ["grocery", "supermarket", "whole foods", "trader joe", "kroger", "safeway", "costco", "walmart"],
  Software: ["aws", "github", "adobe", "microsoft", "google workspace", "slack", "zoom", "figma", "notion", "atlassian"],
  Office: ["staples", "office depot", "fedex", "ups", "usps", "printing"],
  Equipment: ["apple", "best buy", "dell", "hp", "logitech", "amazon"],
};

function guessCategory(merchant: string, lineItems: string[]): { category: string; confidence: number } {
  const text = [merchant, ...lineItems].join(" ").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        return { category, confidence: 85 };
      }
    }
  }
  return { category: "Other", confidence: 50 };
}

// ─── Textract expense parser ──────────────────────────────────────────────────
async function runTextractExpenseAnalysis(bucket: string, key: string): Promise<string> {
  const { JobId } = await textract.send(new StartExpenseAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
  }));
  if (!JobId) throw new Error("Textract did not return a JobId");

  // Poll for completion (up to 30s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const result = await textract.send(new GetExpenseAnalysisCommand({ JobId }));
    if (result.JobStatus === "SUCCEEDED") {
      return JobId;
    }
    if (result.JobStatus === "FAILED") {
      throw new Error(`Textract job failed: ${result.StatusMessage}`);
    }
  }
  throw new Error("Textract timed out");
}

async function getTextractResults(jobId: string): Promise<ExpenseDocument[]> {
  const result = await textract.send(new GetExpenseAnalysisCommand({ JobId: jobId }));
  return result.ExpenseDocuments || [];
}

function parseExpenseDocuments(docs: ExpenseDocument[]) {
  const extracted: Record<string, string | number | undefined> = {};
  const lineItems: string[] = [];

  for (const doc of docs) {
    // Summary fields
    for (const field of doc.SummaryFields || []) {
      const type = field.Type?.Text?.toUpperCase();
      const value = field.ValueDetection?.Text;
      if (!type || !value) continue;

      switch (type) {
        case "VENDOR_NAME": extracted.merchant = value; break;
        case "TOTAL": extracted.total = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "SUBTOTAL": extracted.subtotal = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "TAX": extracted.tax = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "GRATUITY": extracted.tip = parseFloat(value.replace(/[^0-9.]/g, "")); break;
        case "INVOICE_RECEIPT_DATE": extracted.date = value; break;
        case "PAYMENT_TERMS": break;
        case "RECEIVER_ADDRESS": extracted.merchantAddress = value; break;
      }
    }

    // Line items
    for (const group of doc.LineItemGroups || []) {
      for (const item of group.LineItems || []) {
        const desc = item.LineItemExpenseFields?.find(f => f.Type?.Text === "ITEM")?.ValueDetection?.Text;
        if (desc) lineItems.push(desc);
      }
    }
  }

  return { extracted, lineItems };
}

// ─── Claude AI Enrichment ─────────────────────────────────────────────────────
async function enrichWithClaude(extracted: Record<string, unknown>, lineItems: string[]) {
  const prompt = `You are an expense categorization AI. Given this receipt data, return a JSON object with these fields only:
- category: one of [Travel, Meals, Groceries, Software, Office, Equipment, Other]
- confidence: integer 0-100
- suggestedTags: array of 1-3 lowercase strings
- policyFlags: array of strings if anything seems unusual (e.g. "high amount", "entertainment", "luxury item") or empty array

Receipt data:
Merchant: ${extracted.merchant || "Unknown"}
Total: ${extracted.total || "Unknown"}
Line items: ${lineItems.slice(0, 10).join(", ") || "None"}

Respond with valid JSON only. No explanation.`;

  const response = await bedrock.send(new InvokeModelCommand({
    modelId: BEDROCK_MODEL,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    }),
  }));

  const text = JSON.parse(new TextDecoder().decode(response.body)).content[0].text;
  return JSON.parse(text);
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = async (event: S3Event) => {
  const startMs = Date.now();

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    // Key format: receipts/{userId}/{expenseId}/{scanId}/{filename}
    const parts = key.split("/");
    if (parts[0] !== "receipts" || parts.length < 5) {
      logger.warn("Unexpected S3 key format", { key });
      continue;
    }

    const [, userId, expenseId, scanId] = parts;
    const mimeType = key.endsWith(".pdf") ? "application/pdf" : "image/jpeg";

    logger.appendKeys({ userId, expenseId, scanId, bucket, key });
    logger.info("Processing receipt scan");

    // Write initial scan record
    const now = new Date().toISOString();
    const scanRecord: ScanResult = {
      pk: `RECEIPT#${expenseId}`,
      sk: `SCAN#${scanId}`,
      entityType: "SCAN",
      scanId,
      expenseId,
      userId,
      s3Key: key,
      s3Bucket: bucket,
      mimeType,
      fileSizeBytes: record.s3.object.size,
      status: "processing",
      createdAt: now,
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30-day TTL
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: scanRecord }));

    try {
      // 1. Run Textract
      const segment = tracer.getSegment()!;
      const textractSub = tracer.addNewSubsegment("textractAnalysis");
      const jobId = await runTextractExpenseAnalysis(bucket, key);
      const docs = await getTextractResults(jobId);
      textractSub.close();

      const { extracted, lineItems } = parseExpenseDocuments(docs);
      logger.info("Textract complete", { extracted, lineItemCount: lineItems.length });

      // 2. AI enrichment with Claude
      const bedrockSub = tracer.addNewSubsegment("claudeEnrichment");
      let aiEnrichment = guessCategory(String(extracted.merchant || ""), lineItems);
      try {
        const claudeResult = await enrichWithClaude(extracted, lineItems);
        aiEnrichment = {
          category: claudeResult.category,
          confidence: claudeResult.confidence,
          suggestedTags: claudeResult.suggestedTags,
          policyFlags: claudeResult.policyFlags,
        };
        metrics.addMetric("ClaudeEnrichmentSuccess", MetricUnit.Count, 1);
      } catch (e) {
        logger.warn("Claude enrichment failed, using keyword fallback", { error: e });
        metrics.addMetric("ClaudeEnrichmentFallback", MetricUnit.Count, 1);
      }
      bedrockSub.close();

      const processingMs = Date.now() - startMs;

      // 3. Update scan record with results
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
        UpdateExpression: `SET #status = :status, extractedData = :data, aiEnrichment = :ai,
                              textractJobId = :jobId, processingMs = :ms`,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "completed",
          ":data": { ...extracted, lineItems: lineItems.map(d => ({ description: d, total: 0 })) },
          ":ai": aiEnrichment,
          ":jobId": jobId,
          ":ms": processingMs,
        },
      }));

      // 4. Update the parent expense with extracted data
      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `USER#${userId}`, sk: `EXPENSE#${expenseId}` },
        UpdateExpression: `SET scanId = :sid, 
          merchant = if_not_exists(merchant, :merchant),
          amount = if_not_exists(amount, :amount),
          #date = if_not_exists(#date, :date),
          category = if_not_exists(category, :category),
          receiptKey = :key,
          updatedAt = :now`,
        ExpressionAttributeNames: { "#date": "date" },
        ExpressionAttributeValues: {
          ":sid": scanId,
          ":merchant": extracted.merchant || "Unknown",
          ":amount": extracted.total || 0,
          ":date": extracted.date || now.slice(0, 10),
          ":category": aiEnrichment.category,
          ":key": key,
          ":now": now,
        },
      }));

      // 5. Publish event to EventBridge
      await eb.send(new PutEventsCommand({
        Entries: [{
          EventBusName: EVENT_BUS,
          Source: "costscrunch.receipts",
          DetailType: "ReceiptScanCompleted",
          Detail: JSON.stringify({
            userId, expenseId, scanId,
            merchant: extracted.merchant,
            amount: extracted.total,
            category: aiEnrichment.category,
            confidence: aiEnrichment.confidence,
            processingMs,
          }),
        }],
      }));

      metrics.addMetric("ScanCompleted", MetricUnit.Count, 1);
      metrics.addMetric("ScanProcessingTime", MetricUnit.Milliseconds, processingMs);
      metrics.addMetric("ScanConfidence", MetricUnit.None, aiEnrichment.confidence);
      logger.info("Scan pipeline complete", { processingMs, confidence: aiEnrichment.confidence });

    } catch (error) {
      logger.error("Scan pipeline failed", { error });
      metrics.addMetric("ScanFailed", MetricUnit.Count, 1);

      await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `RECEIPT#${expenseId}`, sk: `SCAN#${scanId}` },
        UpdateExpression: "SET #status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": "failed" },
      }));

      throw error; // re-throw so Lambda retries / sends to DLQ
    }
  }
};