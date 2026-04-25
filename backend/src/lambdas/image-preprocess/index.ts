// ─── CostsCrunch — Image Preprocessing Lambda ──────────────────────────────────
// Triggered by: S3 POST on uploads/ prefix
// Responsibility: Compress images using Sharp (lossless) and upload to processed bucket
// Pipeline: Upload Bucket → [this file] → Processed Bucket → Receipts Lambda
// Invalid files → Quarantine Bucket → WebSocket notification

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import type { S3Event } from "aws-lambda";
import sharp from "sharp";
import { Readable } from "stream";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";

// ─── Clients ──────────────────────────────────────────────────────────────────
const s3 = new S3Client(
  process.env.AWS_ENDPOINT_URL
    ? {
        endpoint: process.env.AWS_ENDPOINT_URL,
        forcePathStyle: true,
        region: process.env.AWS_REGION ?? "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
        },
      }
    : {}
);
const ddb = createDynamoDBDocClient();

// ─── Configuration ────────────────────────────────────────────────────────────
const UPLOADS_BUCKET    = process.env.BUCKET_UPLOADS_NAME!;
const PROCESSED_BUCKET = process.env.BUCKET_PROCESSED_NAME!;
const QUARANTINE_BUCKET = process.env.BUCKET_QUARANTINE_NAME!;
const TABLE_NAME       = process.env.TABLE_NAME_MAIN!;
const WEBSOCKET_ENDPOINT = process.env.WEBSOCKET_ENDPOINT || "";
const MAX_FILE_SIZE    = 10 * 1024 * 1024; // 10MB
const MAX_DIMENSION    = 10000; // Max width/height in pixels

const logger  = new Logger({ serviceName: "image-preprocess" });
const tracer  = new Tracer({ serviceName: "image-preprocess" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "image-preprocess" });

// ─── Supported formats ─────────────────────────────────────────────────────────
const SUPPORTED_FORMATS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
} as const;

type SupportedMimeType = keyof typeof SUPPORTED_FORMATS;

// ─── Failure reasons ────────────────────────────────────────────────────────────
type FailureReason = 
  | "UNSUPPORTED_FORMAT" 
  | "CORRUPT_FILE" 
  | "DIMENSION_EXCEEDED"
  | "SIZE_EXCEEDED"
  | "SHARP_ERROR";

interface QuarantineResult {
  success: false;
  reason: FailureReason;
  message: string;
}

interface SuccessResult {
  success: true;
  processedKey: string;
  originalSize: number;
  compressedSize: number;
}

type ProcessResult = QuarantineResult | SuccessResult;

// ─── Helper: stream to buffer ──────────────────────────────────────────────────
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ─── Helper: get content type and extension ─────────────────────────────────────
function getContentType(key: string, mimeType?: string): SupportedMimeType | null {
  // First check explicit MIME type from metadata
  if (mimeType && mimeType in SUPPORTED_FORMATS) {
    return mimeType as SupportedMimeType;
  }
  
  // Fall back to extension
  const ext = key.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'pdf') return 'application/pdf';
  
  return null;
}

// ─── Helper: WebSocket notification ────────────────────────────────────────────
async function notifyUserViaWebSocket(connectionId: string, payload: object): Promise<void> {
  if (!WEBSOCKET_ENDPOINT || connectionId === "GUEST") {
    logger.debug("WebSocket notification skipped", { connectionId, reason: !WEBSOCKET_ENDPOINT ? "no endpoint" : "guest" });
    return;
  }

  try {
    const wsClient = new ApiGatewayManagementApiClient({
      endpoint: WEBSOCKET_ENDPOINT.replace("wss://", "https://"),
    });
    await wsClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(payload)),
    }));
    logger.info("WebSocket notification sent", { connectionId });
  } catch (error: any) {
    if (error.name === "GoneException" || error.$metadata?.httpStatusCode === 410) {
      logger.warn("WebSocket connection expired", { connectionId });
    } else {
      logger.error("Failed to send WebSocket notification", { error: error.message, connectionId });
    }
  }
}

// ─── Helper: get connection ID from DynamoDB ─────────────────────────────────────
async function getConnectionId(userId: string): Promise<string | null> {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "gsi1pk = :pk AND begins_with(gsi1sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${userId}`,
        ":prefix": "CONNECTION#",
      },
      Limit: 1,
    }));
    return result.Items?.[0]?.connectionId ?? null;
  } catch {
    return null;
  }
}

// ─── Helper: move file to quarantine bucket ─────────────────────────────────────
async function quarantineFile(
  sourceKey: string,
  reason: FailureReason,
  message: string,
  userId: string,
  expenseId: string,
  scanId: string
): Promise<void> {
  const quarantineKey = `quarantine/${userId}/${expenseId}/${scanId}/${reason}/${Date.now()}`;

  try {
    // Copy to quarantine bucket
    await s3.send(new CopyObjectCommand({
      Bucket: QUARANTINE_BUCKET,
      CopySource: `${UPLOADS_BUCKET}/${sourceKey}`,
      Key: quarantineKey,
      Metadata: {
        "original-key": sourceKey,
        "failure-reason": reason,
        "failure-message": message,
        "user-id": userId,
        "expense-id": expenseId,
        "scan-id": scanId,
        "quarantined-at": new Date().toISOString(),
      },
    }));

    // Delete from uploads bucket
    await s3.send(new DeleteObjectCommand({
      Bucket: UPLOADS_BUCKET,
      Key: sourceKey,
    }));

    logger.info("File quarantined", { quarantineKey, reason, message });
    metrics.addMetric("FileQuarantined", MetricUnit.Count, 1);

    // Notify user via WebSocket
    const connectionId = await getConnectionId(userId);
    if (connectionId) {
      await notifyUserViaWebSocket(connectionId, {
        type: "QUARANTINE",
        expenseId,
        scanId,
        reason,
        message,
        action: "Please upload a valid image or PDF receipt",
      });
    }
  } catch (error) {
    logger.error("Failed to quarantine file", { error, sourceKey });
    throw error;
  }
}

// ─── Helper: validate image with Sharp ─────────────────────────────────────────
async function validateImage(buffer: Buffer): Promise<{ valid: boolean; reason?: FailureReason; message?: string }> {
  try {
    const metadata = await sharp(buffer).metadata();
    
    // Check dimensions
    if (metadata.width && metadata.width > MAX_DIMENSION) {
      return { 
        valid: false, 
        reason: "DIMENSION_EXCEEDED",
        message: `Image width ${metadata.width}px exceeds maximum of ${MAX_DIMENSION}px`
      };
    }
    if (metadata.height && metadata.height > MAX_DIMENSION) {
      return { 
        valid: false, 
        reason: "DIMENSION_EXCEEDED",
        message: `Image height ${metadata.height}px exceeds maximum of ${MAX_DIMENSION}px`
      };
    }

    return { valid: true };
  } catch (error: any) {
    return { 
      valid: false, 
      reason: "CORRUPT_FILE",
      message: `Unable to read image: ${error.message}`
    };
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withErrorHandler(async (event: S3Event) => {
  logger.info("Processing S3 event", { recordCount: event.Records.length });

  for (const record of event.Records) {
    // Only process POST events (new uploads)
    if (!record.eventName.includes("ObjectCreated")) {
      logger.debug("Skipping non-create event", { eventName: record.eventName });
      continue;
    }

    const uploadBucket = record.s3.bucket.name;
    const uploadKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const fileSize = record.s3.object.size;

    logger.appendKeys({ uploadBucket, uploadKey, fileSize });

    // ── 1. Validate key shape: uploads/{userId}/{expenseId}/{scanId}/{filename}
    const parts = uploadKey.split("/");
    if (parts[0] !== "uploads" || parts.length < 5) {
      logger.warn("Unexpected S3 key format — skipping", { uploadKey });
      continue;
    }

    const [, userId, expenseId, scanId, filename] = parts;
    const isGuest = userId === "guest" || parts[1] === "guest";

    tracer.putAnnotation("receiptId", expenseId);

    // ── 2. Check file size
    if (fileSize > MAX_FILE_SIZE) {
      logger.warn("File exceeds maximum size", { fileSize, maxSize: MAX_FILE_SIZE });
      metrics.addMetric("FileSizeExceeded", MetricUnit.Count, 1);
      await quarantineFile(uploadKey, "SIZE_EXCEEDED", `File size ${fileSize} exceeds maximum of ${MAX_FILE_SIZE} bytes`, userId, expenseId, scanId);
      continue;
    }

    try {
      // ── 3. Get object metadata to check MIME type
      const headResult = await s3.send(new HeadObjectCommand({
        Bucket: uploadBucket,
        Key: uploadKey,
      }));

      const contentType = getContentType(uploadKey, headResult.ContentType);
      
      if (!contentType) {
        logger.warn("Unsupported file type", { uploadKey, mimeType: headResult.ContentType });
        metrics.addMetric("UnsupportedFormat", MetricUnit.Count, 1);
        await quarantineFile(uploadKey, "UNSUPPORTED_FORMAT", `Unsupported file type: ${headResult.ContentType || 'unknown'}`, userId, expenseId, scanId);
        continue;
      }

      // ── 4. Download the file
      logger.info("Downloading file for compression");
      const getResult = await s3.send(new GetObjectCommand({
        Bucket: uploadBucket,
        Key: uploadKey,
      }));

      const bodyBuffer = await streamToBuffer(getResult.Body as Readable);
      const format = SUPPORTED_FORMATS[contentType];

      // ── 5. Validate image (non-PDF)
      if (format !== "pdf") {
        const validation = await validateImage(bodyBuffer);
        if (!validation.valid) {
          logger.warn("Image validation failed", { reason: validation.reason, message: validation.message });
          await quarantineFile(uploadKey, validation.reason!, validation.message!, userId, expenseId, scanId);
          continue;
        }
      }

      let processedBuffer: Buffer;
      let outputFormat: string;

      // ── 6. Process based on file type
      const preprocessSubsegment = tracer.getSegment()?.addNewSubsegment("ImageProcessing");
      preprocessSubsegment?.addAnnotation("stage", "preprocess");

      try {
        if (format === "pdf") {
          // PDF: pass through unchanged (no lossless compression needed)
          logger.info("PDF detected — passing through unchanged");
          processedBuffer = bodyBuffer;
          outputFormat = "pdf";
        } else if (format === "heic") {
          // HEIC: convert to JPEG with lossless quality
          logger.info("HEIC detected — converting to JPEG");
          processedBuffer = await sharp(bodyBuffer)
            .jpeg({ 
              quality: 100,  // Lossless quality
              mozjpeg: true, // Better compression
            })
            .toBuffer();
          outputFormat = "jpg";
        } else if (format === "png") {
          // PNG: lossless compression (already lossless, just optimize)
          logger.info("PNG detected — applying lossless compression");
          processedBuffer = await sharp(bodyBuffer)
            .png({ 
              compressionLevel: 9, // Maximum compression
              adaptiveFiltering: true,
            })
            .toBuffer();
          outputFormat = "png";
        } else {
          // JPEG: re-compress with lossless quality
          logger.info("JPEG detected — applying lossless compression");
          processedBuffer = await sharp(bodyBuffer)
            .jpeg({ 
              quality: 100,  // Lossless quality
              mozjpeg: true, // Better compression
            })
            .toBuffer();
          outputFormat = "jpg";
        }
      } catch (sharpError: any) {
        // Sharp failed — quarantine the file
        logger.error("Sharp processing failed", { error: sharpError.message });
        await quarantineFile(uploadKey, "SHARP_ERROR", `Image processing failed: ${sharpError.message}`, userId, expenseId, scanId);
        continue;
      }

      preprocessSubsegment?.close();

      const originalSize = bodyBuffer.length;
      const compressedSize = processedBuffer.length;
      const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);

      logger.info("Compression complete", {
        originalSize,
        compressedSize,
        compressionRatio: `${compressionRatio}%`,
        outputFormat,
      });

      metrics.addMetric("ImageCompressed", MetricUnit.Count, 1);
      metrics.addMetric("CompressionRatio", MetricUnit.Percent, parseFloat(compressionRatio));

      // ── 7. Upload to processed bucket
      // Preserve the same key structure: receipts/{userId}/{expenseId}/{scanId}/{filename}
      const extension = outputFormat === "jpg" ? ".jpg" : `.${outputFormat}`;
      const baseFilename = filename.replace(/\.[^.]+$/, "");
      const processedKey = `receipts/${userId}/${expenseId}/${scanId}/${baseFilename}${extension}`;

      await s3.send(new PutObjectCommand({
        Bucket: PROCESSED_BUCKET,
        Key: processedKey,
        Body: processedBuffer,
        ContentType: contentType,
        Metadata: {
          userid: userId,
          expenseid: expenseId,
          scanid: scanId,
          originalsize: originalSize.toString(),
          compressedsize: compressedSize.toString(),
          compressionratio: compressionRatio,
        },
      }));

      logger.info("Uploaded to processed bucket", {
        processedBucket: PROCESSED_BUCKET,
        processedKey,
      });

      metrics.addMetric("ImageUploaded", MetricUnit.Count, 1);

      // Delete original from uploads bucket after successful processing
      await s3.send(new DeleteObjectCommand({
        Bucket: UPLOADS_BUCKET,
        Key: uploadKey,
      }));

    } catch (error) {
      logger.error("Failed to process image", { 
        error: error instanceof Error ? error.message : String(error),
        uploadKey,
      });
      metrics.addMetric("ProcessingError", MetricUnit.Count, 1);
      
      // Quarantine the file on unexpected errors
      await quarantineFile(
        uploadKey, 
        "SHARP_ERROR", 
        `Processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        userId, 
        expenseId, 
        scanId
      );
    }
  }

  logger.info("Image preprocessing complete");
});
