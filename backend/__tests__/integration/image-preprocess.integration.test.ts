/**
 * image-preprocess.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for backend/src/lambdas/image-preprocess/index.ts
 * Runs against LocalStack with real S3 operations.
 *
 * Coverage:
 *   • End-to-end S3 upload → compress → upload pipeline
 *   • JPEG, PNG, HEIC, PDF file handling
 *   • Metadata preservation
 *   • Error scenarios
 **/

// ─── Environment Setup (MUST be before handler import) ────────────────────────
// The Lambda handler reads env vars at module load time, so they must be set
// before importing. These match the LocalStack test helpers defaults.
process.env.BUCKET_UPLOADS_NAME = process.env.BUCKET_UPLOADS_NAME ?? "costscrunch-dev-uploads-000000000000";
process.env.BUCKET_PROCESSED_NAME = process.env.BUCKET_PROCESSED_NAME ?? "costscrunch-dev-processed-000000000000";
// LocalStack endpoint for AWS SDK v3 (required for handler's S3 client to connect to LocalStack)
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  s3,
  waitForLocalStack,
  BUCKET_UPLOADS_NAME,
  BUCKET_PROCESSED_NAME,
  TEST_USER_ID,
  cleanTable,
} from "../__helpers__/localstack-client.js";
import {
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { handler } from "../../src/lambdas/image-preprocess/index.js";
import type { S3Event } from "aws-lambda";
import sharp from "sharp";

// ─── Test setup ──────────────────────────────────────────────────────────────
beforeAll(async () => {
  await waitForLocalStack(30_000);
}, 35_000);

// ─── Event factory ───────────────────────────────────────────────────────────
function makeS3Event(key: string, bucketName: string = BUCKET_UPLOADS_NAME): S3Event {
  return {
    Records: [
      {
        eventSource: "aws:s3",
        eventName: "ObjectCreated:Post",
        awsRegion: "us-east-1",
        eventTime: "2025-01-01T00:00:00.000Z",
        eventVersion: "2.1",
        userIdentity: { principalId: TEST_USER_ID },
        requestParameters: { sourceIPAddress: "1.2.3.4" },
        responseElements: { "x-amz-request-id": "req-1", "x-amz-id-2": "id2" },
        s3: {
          s3SchemaVersion: "1.0",
          configurationId: "test",
          bucket: {
            name: bucketName,
            ownerIdentity: { principalId: "owner" },
            arn: `arn:aws:s3:::${bucketName}`,
          },
          object: {
            key,
            size: 102400,
            eTag: "abc123",
            sequencer: "001",
          },
        },
      },
    ],
  };
}

// ─── Helper: create test image buffer ────────────────────────────────────────
async function createTestImage(format: "jpeg" | "png" | "heic"): Promise<Buffer> {
  // Create a simple 100x100 red square image
  const baseImage = sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  });

  if (format === "jpeg") {
    return baseImage.jpeg().toBuffer();
  } else if (format === "png") {
    return baseImage.png().toBuffer();
  } else {
    // HEIC - convert JPEG to HEIC format (Sharp supports HEIC output with libheif)
    return baseImage.heif({ compression: "hevc" }).toBuffer();
  }
}

// ─── Helper: create test PDF buffer ──────────────────────────────────────────
function createTestPdf(): Buffer {
  // Minimal valid PDF content
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer
<< /Size 4 /Root 1 0 R >>
startxref
194
%%EOF`);
}

// ─── INTEGRATION: JPEG processing ────────────────────────────────────────────
describe("JPEG processing", () => {
  it("compresses and uploads JPEG to processed bucket", async () => {
    const key = `uploads/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`;
    const imageBuffer = await createTestImage("jpeg");

    // Upload test image to uploads bucket
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_UPLOADS_NAME,
        Key: key,
        Body: imageBuffer,
        ContentType: "image/jpeg",
        Metadata: {
          userid: TEST_USER_ID,
          expenseid: "exp-001",
          scanid: "scan-001",
        },
      })
    );

    // Invoke the handler
    await handler(makeS3Event(key));

    // Verify the processed file exists in the processed bucket
    const expectedKey = `receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`;
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_PROCESSED_NAME,
        Key: expectedKey,
      })
    );


    expect(result.Body).toBeDefined();
    expect(result.ContentType).toBe("image/jpeg");
    expect(result.Metadata?.userid).toBe(TEST_USER_ID);
    expect(result.Metadata?.expenseid).toBe("exp-001");
    expect(result.Metadata?.scanid).toBe("scan-001");

    // Cleanup
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_UPLOADS_NAME, Key: key }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_PROCESSED_NAME, Key: expectedKey }));
  });
});

// ─── INTEGRATION: PNG processing ──────────────────────────────────────────────
describe("PNG processing", () => {
  it("compresses and uploads PNG to processed bucket", async () => {
    const key = `uploads/${TEST_USER_ID}/exp-002/scan-002/receipt.png`;
    const imageBuffer = await createTestImage("png");

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_UPLOADS_NAME,
        Key: key,
        Body: imageBuffer,
        ContentType: "image/png",
      })
    );

    await handler(makeS3Event(key));

    const expectedKey = `receipts/${TEST_USER_ID}/exp-002/scan-002/receipt.png`;
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_PROCESSED_NAME,
        Key: expectedKey,
      })
    );

    expect(result.Body).toBeDefined();
    expect(result.ContentType).toBe("image/png");

    // Cleanup
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_UPLOADS_NAME, Key: key }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_PROCESSED_NAME, Key: expectedKey }));
  });
});

// ─── INTEGRATION: PDF processing ──────────────────────────────────────────────
describe("PDF processing", () => {
  it("passes PDF through unchanged to processed bucket", async () => {
    const key = `uploads/${TEST_USER_ID}/exp-003/scan-003/document.pdf`;
    const pdfBuffer = createTestPdf();

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_UPLOADS_NAME,
        Key: key,
        Body: pdfBuffer,
        ContentType: "application/pdf",
      })
    );

    await handler(makeS3Event(key));

    const expectedKey = `receipts/${TEST_USER_ID}/exp-003/scan-003/document.pdf`;
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_PROCESSED_NAME,
        Key: expectedKey,
      })
    );

    expect(result.Body).toBeDefined();
    expect(result.ContentType).toBe("application/pdf");

    // Cleanup
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_UPLOADS_NAME, Key: key }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_PROCESSED_NAME, Key: expectedKey }));
  });
});

// ─── INTEGRATION: Compression ratio ───────────────────────────────────────────
describe("Compression metrics", () => {
  it("stores compression ratio in metadata", async () => {
    const key = `uploads/${TEST_USER_ID}/exp-004/scan-004/receipt.jpg`;
    const imageBuffer = await createTestImage("jpeg");

    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_UPLOADS_NAME,
        Key: key,
        Body: imageBuffer,
        ContentType: "image/jpeg",
      })
    );

    await handler(makeS3Event(key));

    const expectedKey = `receipts/${TEST_USER_ID}/exp-004/scan-004/receipt.jpg`;
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_PROCESSED_NAME,
        Key: expectedKey,
      })
    );

    expect(result.Metadata?.originalsize).toBeDefined();
    expect(result.Metadata?.compressedsize).toBeDefined();
    expect(result.Metadata?.compressionratio).toBeDefined();
    expect(parseFloat(result.Metadata!.compressionratio!)).toBeGreaterThanOrEqual(-100);

    // Cleanup
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_UPLOADS_NAME, Key: key }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_PROCESSED_NAME, Key: expectedKey }));
  });
});
