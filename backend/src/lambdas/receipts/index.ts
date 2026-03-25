// ─── CostsCrunch — S3 Initiator Lambda ──────────────────────────────────────────
// Triggered by: S3 PUT on processed bucket (receipts/ prefix after preprocessing)
// Responsibility: write the initial scan record, then hand off to Textract async.
// Textract publishes to SNS on completion → sns-webhook.ts picks up from there.
// Pipeline: UploadsBucket → image-preprocess → ProcessedBucket → [this file] → Textract

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  TextractClient,
  StartExpenseAnalysisCommand,
} from "@aws-sdk/client-textract";
import {
  PutCommand,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient, createS3Client } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { logger as internalLogger } from "../../utils/logger.js";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import type { S3Event, APIGatewayProxyEventV2 } from "aws-lambda";
import { ulid } from "ulid";
import type { ScanResult } from "../../shared/models/types.js";
import { initiateUploadSchema } from "../../shared/validation/schemas.js";

// ─── Clients ──────────────────────────────────────────────────────────────────
const s3 = createS3Client();
const textract = new TextractClient({});
const ddb = createDynamoDBDocClient();

const TABLE         = process.env.TABLE_NAME_MAIN!;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// SNS topic + IAM role Textract will publish to on job completion
const TEXTRACT_SNS_TOPIC_ARN = process.env.TEXTRACT_SNS_TOPIC_ARN!;
const TEXTRACT_ROLE_ARN      = process.env.TEXTRACT_ROLE_ARN!;

const logger = new Logger({ serviceName: "receipts" });
const tracer = new Tracer({ serviceName: "receipts" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "receipts" });


// ─── Event-shape type guards ──────────────────────────────────────────────────
// REST API v1 events have httpMethod+path but no routeKey; HTTP API v2 has routeKey.
function isApiGatewayEvent(event: unknown): event is APIGatewayProxyEventV2 {
  const e = event as any;
  return typeof e.routeKey === "string" || typeof e.httpMethod === "string";
}

function isS3Event(event: unknown): event is S3Event {
  const e = event as S3Event;
  return Array.isArray(e.Records) && e.Records[0]?.eventSource === "aws:s3";
}

// Build a normalised route string that works for both REST v1 and HTTP v2
function resolveRoute(event: any): string {
  if (event.routeKey) return event.routeKey;
  const method = event.httpMethod || "";
  const path = event.path || event.requestContext?.http?.path || "";
  return `${method} ${path}`;
}

// ─── Sub-handler: Generate Pre-signed POST ────────────────────────────────────
const ok = (body: unknown) => ({ 
  statusCode: 200, 
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
  body: JSON.stringify(body) 
});
const err = (msg: string, code = 400) => ({ 
  statusCode: code, 
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
  body: JSON.stringify({ error: msg }) 
});

async function handleUploadUrl(event: APIGatewayProxyEventV2) {
  const userId = (event.requestContext as any)?.authorizer?.jwt?.claims?.sub as string | undefined;
  if (!userId) return err("Unauthorized", 401);

  const bodyRaw = JSON.parse(event.body || "{}");
  const parsed = initiateUploadSchema.safeParse(bodyRaw);
  if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

  const { filename, contentType, fileSizeBytes, expenseId: existingExpenseId } = parsed.data;
  const expenseId = existingExpenseId || ulid();
  const scanId = ulid();
  // Upload to uploads bucket with uploads/ prefix — preprocessing Lambda will move to processed bucket
  const key = `uploads/${userId}/${expenseId}/${scanId}/${filename}`;

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: process.env.BUCKET_UPLOADS_NAME!,
    Key: key,
    Conditions: [
      ["content-length-range", 1, Math.min(fileSizeBytes || MAX_FILE_SIZE, MAX_FILE_SIZE)],
      ["eq", "$Content-Type", contentType],
    ],
    Fields: {
      "Content-Type": contentType,
      "x-amz-meta-userid": userId,
      "x-amz-meta-expenseid": expenseId,
    },
    Expires: 900, // 15 mins
  });

  return ok({ url, fields, key, expenseId, scanId });
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withLocalAuth(withErrorHandler(async (event: S3Event | APIGatewayProxyEventV2) => {

  logger.info("Received event raw shape", { 
    keys: Object.keys(event),
    isS3: "Records" in event,
    isApi: isApiGatewayEvent(event)
  });
  
  if (process.env.DEBUG_EVENT === "true") {
    internalLogger.debug("FULL_EVENT_DEBUG", { event });
  }

  // ─── Route by event shape ──────────────────────────────────────────────────
  if (isApiGatewayEvent(event)) {
    const route = resolveRoute(event);

    if (route.includes("/upload-url")) {
      try {
        return await handleUploadUrl(event);
      } catch {
        return err("Failed to generate upload URL", 500);
      }
    }

    // GET /receipts/{expenseId}/scan — poll scan result
    if (route.includes("/scan")) {
      const expenseId = (event.pathParameters as any)?.expenseId
        || route.match(/\/receipts\/([^/]+)\/scan/)?.[1];
      if (!expenseId) return err("expenseId is required", 400);

      const result = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `RECEIPT#${expenseId}`,
          ":prefix": "SCAN#",
        },
      }));

      const scans = result.Items || [];
      return ok({ items: scans, count: scans.length });
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
    tracer.putAnnotation("receiptId", expenseId);
    
    const textractSubsegment = tracer.getSegment()?.addNewSubsegment("TextractJobStart");
    textractSubsegment?.addAnnotation("stage", "textract");
    
    let JobId;
    try {
      const response = await textract.send(
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
      JobId = response.JobId;
    } finally {
      textractSubsegment?.close();
    }

    if (!JobId) throw new Error("Textract did not return a JobId");

    logger.info("Textract job started", { JobId });
    metrics.addMetric("TextractJobStarted", MetricUnit.Count, 1);
  }
}));