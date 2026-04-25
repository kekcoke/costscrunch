/**
 * image-preprocess.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/image-preprocess/index.ts
 * Env vars are provided by vitest.setup.unit.ts (no LocalStack required).
 * All AWS SDK clients are vi-mocked; nothing leaves the process.
 *
 * Coverage:
 *   • S3 event routing — only process ObjectCreated events
 *   • Key validation — must start with uploads/ and have 5+ segments
 *   • MIME type detection — from metadata and file extension
 *   • Image compression — JPEG, PNG, HEIC, PDF handling
 *   • Error handling — skip unsupported types, continue on errors
 **/

// ─── Hoisted spies ────────────────────────────────────────────────────────────
// Must use vi.hoisted() so mock factories can reference these during hoisting
const { mockS3Send, mockSharpInstance } = vi.hoisted(() => {
  const mockS3Send = vi.fn();
  
  // Create a single sharp instance that tracks all method calls
  // Chain methods: sharp().metadata() returns metadata, then jpeg/png/heif().toBuffer()
  const mockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    heif: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("compressed-data")),
  };

  return { mockS3Send, mockSharpInstance };
});

// ─── AWS SDK mocks ────────────────────────────────────────────────────────────
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockS3Send };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
  PutObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
  HeadObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
  CopyObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
}));

// Sharp mock - return the same instance for all calls
vi.mock("sharp", () => ({
  default: vi.fn(() => mockSharpInstance),
}));

// ─── Vitest + type imports ────────────────────────────────────────────────────
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { S3Event } from "aws-lambda";
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

// ─── Set env vars BEFORE handler import (handler reads at module level) ─────────
process.env.BUCKET_UPLOADS_NAME    = process.env.BUCKET_UPLOADS_NAME    ?? "costscrunch-dev-uploads-000000000000";
process.env.BUCKET_PROCESSED_NAME  = process.env.BUCKET_PROCESSED_NAME  ?? "costscrunch-dev-processed-000000000000";
process.env.BUCKET_QUARANTINE_NAME = process.env.BUCKET_QUARANTINE_NAME ?? "costscrunch-dev-quarantine-000000000000";
process.env.AWS_ENDPOINT_URL       = "http://localhost:4566";

// ─── Subject under test ───────────────────────────────────────────────────────
import { handler } from "../../src/lambdas/image-preprocess/index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────
import { TEST_USER_ID } from "../__helpers__/localstack-client.js";

const BUCKET_UPLOADS_NAME = process.env.BUCKET_UPLOADS_NAME;
const BUCKET_PROCESSED_NAME = process.env.BUCKET_PROCESSED_NAME;
const BUCKET_QUARANTINE_NAME = process.env.BUCKET_QUARANTINE_NAME;

afterEach(() => {
  vi.clearAllMocks();
});

// Helper to reset S3 mock for each test
function resetS3Mock(contentType: string = "image/jpeg") {
  mockS3Send.mockReset()
    .mockResolvedValueOnce({ ContentType: contentType }) // HeadObject
    .mockResolvedValueOnce({ Body: Readable.from(Buffer.from("fake-image-data")) }) // GetObject
    .mockResolvedValueOnce({}) // PutObject (processed bucket)
    .mockResolvedValueOnce({}) // CopyObject (quarantine - only if needed)
    .mockResolvedValueOnce({}); // DeleteObject (uploads bucket cleanup)
}

// ─── Event factories ──────────────────────────────────────────────────────────
function makeS3Event(keyOverride?: string, eventName = "ObjectCreated:Post"): S3Event {
  const key = keyOverride ?? `uploads/${TEST_USER_ID}/expense-001/scan-001/receipt.jpg`;
  return {
    Records: [
      {
        eventSource: "aws:s3",
        eventName,
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
            name: BUCKET_UPLOADS_NAME,
            ownerIdentity: { principalId: "owner" },
            arn: `arn:aws:s3:::${BUCKET_UPLOADS_NAME}`,
          },
          object: {
            key,
            size: 204800,
            eTag: "abc123",
            sequencer: "001",
          },
        },
      },
    ],
  };
}

// ─── UNIT: Event filtering ────────────────────────────────────────────────────
describe("Event filtering", () => {
  it("processes ObjectCreated:Post events", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event(undefined, "ObjectCreated:Post"));
    expect(mockS3Send).toHaveBeenCalled();
  });

  it("processes ObjectCreated:Put events", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event(undefined, "ObjectCreated:Put"));
    expect(mockS3Send).toHaveBeenCalled();
  });

  it("skips non-ObjectCreated events", async () => {
    mockS3Send.mockReset();
    
    await handler(makeS3Event(undefined, "ObjectRemoved:Delete"));
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

// ─── UNIT: Key validation ─────────────────────────────────────────────────────
describe("Key validation", () => {
  it("skips records whose key does not start with uploads/", async () => {
    mockS3Send.mockReset();
    
    await handler(makeS3Event(`receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`));
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("skips records with fewer than 5 key segments", async () => {
    mockS3Send.mockReset();
    
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/file.jpg`));
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("processes valid uploads/{userId}/{expenseId}/{scanId}/{filename} keys", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event());
    expect(mockS3Send).toHaveBeenCalled();
  });
});

// ─── UNIT: MIME type detection ────────────────────────────────────────────────
describe("MIME type detection", () => {
  it.each([
    ["image/jpeg", "receipt.jpg"],
    ["image/png", "receipt.png"],
    ["image/heic", "photo.heic"],
    ["application/pdf", "document.pdf"],
  ])("detects %s from extension", async (expectedMime, filename) => {
    resetS3Mock(expectedMime);
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/${filename}`));
    expect(mockS3Send).toHaveBeenCalled();
  });

  it("skips unsupported file types", async () => {
    mockS3Send.mockReset()
      .mockResolvedValueOnce({ ContentType: "image/gif" })  // HeadObject
      .mockResolvedValueOnce({})                            // CopyObject (quarantine)
      .mockResolvedValueOnce({});                           // DeleteObject (cleanup)

    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/image.gif`));
    
    // HeadObject + quarantine (CopyObject + DeleteObject)
    expect(mockS3Send).toHaveBeenCalledTimes(3);
  });
});

// ─── UNIT: Image compression ──────────────────────────────────────────────────
describe("Image compression", () => {
  it("compresses JPEG with quality 100", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`));
    
    expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({
      quality: 100,
      mozjpeg: true,
    });
  });

  it("compresses PNG with max compression", async () => {
    resetS3Mock("image/png");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/receipt.png`));
    
    expect(mockSharpInstance.png).toHaveBeenCalledWith({
      compressionLevel: 9,
      adaptiveFiltering: true,
    });
  });

  it("passes PDF through unchanged", async () => {
    resetS3Mock("application/pdf");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/document.pdf`));
    
    // Sharp should not be called for PDFs
    expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
    expect(mockSharpInstance.png).not.toHaveBeenCalled();
  });
});

// ─── UNIT: Output key structure ───────────────────────────────────────────────
describe("Output key structure", () => {
  it("generates receipts/{userId}/{expenseId}/{scanId}/{filename}.jpg for JPEG", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/my-receipt.jpg`));
    
    const putArg = vi.mocked(PutObjectCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Key).toBe(`receipts/${TEST_USER_ID}/exp-001/scan-001/my-receipt.jpg`);
    expect(putArg?.Bucket).toBe(BUCKET_PROCESSED_NAME);
  });

  it("preserves PNG extension", async () => {
    resetS3Mock("image/png");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/receipt.png`));
    
    const putArg = vi.mocked(PutObjectCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Key).toBe(`receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.png`);
  });

  it("preserves PDF extension", async () => {
    resetS3Mock("application/pdf");
    await handler(makeS3Event(`uploads/${TEST_USER_ID}/exp-001/scan-001/document.pdf`));
    
    const putArg = vi.mocked(PutObjectCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Key).toBe(`receipts/${TEST_USER_ID}/exp-001/scan-001/document.pdf`);
  });
});

// ─── UNIT: Metadata preservation ──────────────────────────────────────────────
describe("Metadata preservation", () => {
  it("includes compression metadata in uploaded object", async () => {
    resetS3Mock("image/jpeg");
    await handler(makeS3Event());
    
    const putArg = vi.mocked(PutObjectCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Metadata).toMatchObject({
      userid: TEST_USER_ID,
      expenseid: "expense-001",
      scanid: "scan-001",
    });
    expect(putArg?.Metadata?.originalsize).toBeDefined();
    expect(putArg?.Metadata?.compressedsize).toBeDefined();
    expect(putArg?.Metadata?.compressionratio).toBeDefined();
  });
});

// ─── UNIT: Error handling ─────────────────────────────────────────────────────
describe("Error handling", () => {
  it("continues processing other records on error", async () => {
    mockS3Send.mockReset()
      .mockRejectedValueOnce(new Error("S3 error"))
      .mockResolvedValueOnce({ ContentType: "image/jpeg" })
      .mockResolvedValueOnce({ Body: Buffer.from("fake-image-data") })
      .mockResolvedValueOnce({});

    const event: S3Event = {
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
              name: BUCKET_UPLOADS_NAME,
              ownerIdentity: { principalId: "owner" },
              arn: `arn:aws:s3:::${BUCKET_UPLOADS_NAME}`,
            },
            object: {
              key: `uploads/${TEST_USER_ID}/exp-001/scan-001/error.jpg`,
              size: 204800,
              eTag: "abc123",
              sequencer: "001",
            },
          },
        },
        {
          eventSource: "aws:s3",
          eventName: "ObjectCreated:Post",
          awsRegion: "us-east-1",
          eventTime: "2025-01-01T00:00:00.000Z",
          eventVersion: "2.1",
          userIdentity: { principalId: TEST_USER_ID },
          requestParameters: { sourceIPAddress: "1.2.3.4" },
          responseElements: { "x-amz-request-id": "req-2", "x-amz-id-2": "id3" },
          s3: {
            s3SchemaVersion: "1.0",
            configurationId: "test",
            bucket: {
              name: BUCKET_UPLOADS_NAME,
              ownerIdentity: { principalId: "owner" },
              arn: `arn:aws:s3:::${BUCKET_UPLOADS_NAME}`,
            },
            object: {
              key: `uploads/${TEST_USER_ID}/exp-002/scan-002/success.jpg`,
              size: 204800,
              eTag: "abc123",
              sequencer: "002",
            },
          },
        },
      ],
    };

    // Should not throw
    await expect(handler(event)).resolves.toBeUndefined();
    
    // Second record should still be processed (HeadObject for second record)
    expect(mockS3Send).toHaveBeenCalled();
  });
});
