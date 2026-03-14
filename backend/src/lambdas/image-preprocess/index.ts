// ─── CostsCrunch — Image Preprocessing Lambda ──────────────────────────────────
// Triggered by: S3 POST on uploads/ prefix
// Responsibility: Compress images using Sharp (lossless) and upload to processed bucket
// Pipeline: Upload Bucket → [this file] → Processed Bucket → Receipts Lambda

import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { S3Event } from "aws-lambda";
import sharp from "sharp";
import { Readable } from "stream";

// ─── Clients ──────────────────────────────────────────────────────────────────
// Support LocalStack endpoint for integration testing
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

const UPLOADS_BUCKET = process.env.BUCKET_UPLOADS_NAME!;
const PROCESSED_BUCKET = process.env.BUCKET_PROCESSED_NAME!;

const logger = new Logger({ serviceName: "image-preprocess" });
const tracer = new Tracer({ serviceName: "image-preprocess" });
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

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = async (event: S3Event) => {
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

    try {
      // ── 2. Get object metadata to check MIME type
      const headResult = await s3.send(new HeadObjectCommand({
        Bucket: uploadBucket,
        Key: uploadKey,
      }));

      const contentType = getContentType(uploadKey, headResult.ContentType);
      
      if (!contentType) {
        logger.warn("Unsupported file type — skipping", { 
          uploadKey, 
          mimeType: headResult.ContentType 
        });
        metrics.addMetric("UnsupportedFormat", MetricUnit.Count, 1);
        continue;
      }

      // ── 3. Download the file
      logger.info("Downloading file for compression");
      const getResult = await s3.send(new GetObjectCommand({
        Bucket: uploadBucket,
        Key: uploadKey,
      }));

      const bodyBuffer = await streamToBuffer(getResult.Body as Readable);
      const format = SUPPORTED_FORMATS[contentType];
      
      let processedBuffer: Buffer;
      let outputFormat: string;

      // ── 4. Process based on file type
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

      // ── 5. Upload to processed bucket
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

    } catch (error) {
      logger.error("Failed to process image", { 
        error: error instanceof Error ? error.message : String(error),
        uploadKey,
      });
      metrics.addMetric("ProcessingError", MetricUnit.Count, 1);
      
      // Don't throw — continue processing other records
      // The DLQ will catch persistent failures
    }
  }

  logger.info("Image preprocessing complete");
};
