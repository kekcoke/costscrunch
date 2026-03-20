// ─── CostsCrunch — S3 Initiator Lambda ──────────────────────────────────────────
// Triggered by: S3 PUT on processed bucket (receipts/ prefix after preprocessing)
// Responsibility: write the initial scan record, then hand off to Textract async.
// Textract publishes to SNS on completion → sns-webhook.ts picks up from there.
// Pipeline: UploadsBucket → image-preprocess → ProcessedBucket → [this file] → Textract

import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  TextractClient,
  StartExpenseAnalysisCommand,
} from "@aws-sdk/client-textract";
import {
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { logger as internalLogger } from "../../utils/logger.js";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import type { S3Event, APIGatewayProxyEventV2 } from "aws-lambda";
import { ulid } from "ulid";
import type { ScanResult } from "../../shared/models/types.js";

// ─── Clients ──────────────────────────────────────────────────────────────────
const s3 = new S3Client({});
const textract = new TextractClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE         = process.env.TABLE_NAME_MAIN!;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// SNS topic + IAM role Textract will publish to on job completion
const TEXTRACT_SNS_TOPIC_ARN = process.env.TEXTRACT_SNS_TOPIC_ARN!;
const TEXTRACT_ROLE_ARN      = process.env.TEXTRACT_ROLE_ARN!;

const logger = new Logger({ serviceName: "receipts" });
const tracer = new Tracer({ serviceName: "receipts" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "receipts" });


// ─── Event-shape type guards ──────────────────────────────────────────────────
function isApiGatewayEvent(event: unknown): event is APIGatewayProxyEventV2 {
  return typeof (event as APIGatewayProxyEventV2).routeKey === "string";
}

function isS3Event(event: unknown): event is S3Event {
  const e = event as S3Event;
  return Array.isArray(e.Records) && e.Records[0]?.eventSource === "aws:s3";
}

// ─── Sub-handler: Generate Pre-signed POST ────────────────────────────────────
const ok = (body: unknown) => ({ statusCode: 200, body: JSON.stringify(body) });
const err = (msg: string, code = 400) => ({ statusCode: code, body: JSON.stringify({ error: msg }) });

async function handleUploadUrl(event: APIGatewayProxyEventV2) {
  const body = JSON.parse(event.body || "{}");
  const userId = (event.requestContext as any)?.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) return err("Unauthorized", 401);

  const allowedMimes = ["image/jpeg", "image/png", "image/heic", "application/pdf"];
  if (!allowedMimes.includes(body.contentType)) {
    return err("Invalid file type. Allowed: JPG, PNG, HEIC, PDF");
  }

  const expenseId = ulid();
  const scanId = ulid();
  // Upload to uploads bucket with uploads/ prefix — preprocessing Lambda will move to processed bucket
  const key = `uploads/${userId}/${expenseId}/${scanId}/${body.filename}`;

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: process.env.BUCKET_UPLOADS_NAME!,
    Key: key,
    Conditions: [
      ["content-length-range", 1, MAX_FILE_SIZE],
      ["eq", "$Content-Type", body.contentType],
    ],
    Fields: {
      "Content-Type": body.contentType,
      "x-amz-meta-userid": userId,
      "x-amz-meta-expenseid": expenseId,
    },
    Expires: 900, // 15 mins
  });

  return ok({ url, fields, key, expenseId, scanId });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withErrorHandler(async (event: S3Event | APIGatewayProxyEventV2) => {

  logger.info("Received event raw shape", { 
    keys: Object.keys(event),
    isS3: "Records" in event,
    isApi: "routeKey" in (event as any)
  });
  
  if (process.env.DEBUG_EVENT === "true") {
    internalLogger.debug("FULL_EVENT_DEBUG", { event });
  }

  // ─── Route by event shape ──────────────────────────────────────────────────
  if (isApiGatewayEvent(event)) {
    if (event.routeKey === "POST /receipts/upload-url") {
      try {
        return await handleUploadUrl(event);
      } catch {
        return err("Failed to generate upload URL", 500);
      }
    }
    return err("Not found", 404);
  }

  if (!isS3Event(event)) {
    logger.error("Unrecognised event shape", { event });
    return err("Unknown event type", 400);
  }

  // ─── S3 initiation pipeline ───────────────────────────────────────────────
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key    = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    // ── 1. Validate key shape: receipts/{userId}/{expenseId}/{scanId}/{filename}
    const parts = key.split("/");
    if (parts[0] !== "receipts" || parts.length < 5) {
      logger.warn("Unexpected S3 key format — skipping", { key });
      continue;
    }

    const [, userId, expenseId, scanId] = parts;
    const mimeType = key.endsWith(".pdf") ? "application/pdf" : "image/jpeg";
    logger.appendKeys({ userId, expenseId, scanId, bucket, key });

    // ── 2. Persist initial scan record so the frontend can observe 'processing'
    const now        = new Date().toISOString();
    const scanRecord: ScanResult = {
      pk:            `RECEIPT#${expenseId}`,
      sk:            `SCAN#${scanId}`,
      entityType:    "SCAN",
      scanId,
      expenseId,
      userId,
      s3Key:         key,
      s3Bucket:      bucket,
      mimeType,
      fileSizeBytes: record.s3.object.size,
      status:        "processing",
      createdAt:     now,
      ttl:           Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30-day TTL
    };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: scanRecord }));
    logger.info("Scan record created", { status: "processing" });

    // ── 3. Start async Textract job with SNS notification on completion.
    //       Textract calls the SNS topic when done; sns-webhook.ts handles the rest.
    //       This Lambda returns immediately — no polling, no timeout risk.
    const { JobId } = await textract.send(
      new StartExpenseAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
        NotificationChannel: {
          SNSTopicArn: TEXTRACT_SNS_TOPIC_ARN,
          RoleArn:     TEXTRACT_ROLE_ARN,
        },
        // Tag the job so sns-webhook.ts can correlate back to this scan
        JobTag: `${expenseId}/${scanId}`,
      })
    );

    if (!JobId) throw new Error("Textract did not return a JobId");

    logger.info("Textract job started", { JobId });
    metrics.addMetric("TextractJobStarted", MetricUnit.Count, 1);
  }
});