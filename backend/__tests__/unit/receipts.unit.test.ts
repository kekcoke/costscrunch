/**
 * receipts.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/receipts/index.ts
 * Env vars are provided by vitest.setup.unit.ts (no LocalStack required).
 * All AWS SDK clients are vi-mocked; nothing leaves the process.
 *
 * Coverage:
 *   • Router          — event-shape dispatch (API GW / S3 / unknown)
 *   • handleUploadUrl — auth, MIME validation, presign params, response shape
 *   • S3 key parsing  — prefix guard, segment count, PDF MIME detection
 *
 * NOTE: guessCategory / Bedrock / EventBridge tests have been removed.
 *       index.ts owns only the S3-initiation pipeline (write DDB record +
 *       start Textract job). Category inference lives in sns-webhook.ts and
 *       should be tested there.
 **/

// ─── Hoisted spies ────────────────────────────────────────────────────────────
// vi.hoisted() runs before ANY module is evaluated, so these refs are safe to
// close over inside the vi.mock() factory functions below.
const {
  mockTextractSend,
  mockDynamoDbSend,
  mockS3Send,
  mockCreatePresignedPost,
} = vi.hoisted(() => ({
  mockTextractSend:       vi.fn().mockResolvedValue({ JobId: "textract-job-123" }),
  mockDynamoDbSend:       vi.fn().mockResolvedValue({}),
  mockS3Send:             vi.fn().mockResolvedValue({}),
  mockCreatePresignedPost: vi.fn().mockResolvedValue({
    url:    "https://s3.amazonaws.com/bucket",
    fields: {},
  }),
}));

// ─── AWS SDK mocks ────────────────────────────────────────────────────────────
// All vi.mock() calls are hoisted by Vitest to the top of the compiled output,
// so they always run before the handler import regardless of where they appear
// in source. The factory closures reference the hoisted spies above.

vi.mock("@aws-sdk/s3-presigned-post", () => ({
  // Wire to the hoisted spy so vi.mocked(createPresignedPost) and
  // mockCreatePresignedPost refer to the exact same function object.
  createPresignedPost: mockCreatePresignedPost,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  // Must be a regular function (not arrow) to support `new S3Client()`.
  S3Client: vi.fn().mockImplementation(function () {
    return { send: mockS3Send };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
}));

vi.mock("@aws-sdk/client-textract", () => ({
  // Regular function required for `new TextractClient()`.
  TextractClient: vi.fn().mockImplementation(function () {
    return { send: mockTextractSend };
  }),
  StartExpenseAnalysisCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
}));

// DynamoDBClient is instantiated with `new` and then passed to
// DynamoDBDocumentClient.from(). Both must be mocked consistently.
vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {}; // opaque base-client; only DynamoDBDocumentClient.send matters
  }),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    // .from() is called at module load time; return an object whose .send is
    // the shared hoisted spy so every test can assert on mockDynamoDbSend.
    from: vi.fn().mockImplementation(() => ({
      send: mockDynamoDbSend,
    })),
  },
  PutCommand:    vi.fn().mockImplementation(function (args) { return args; }),
  UpdateCommand: vi.fn().mockImplementation(function (args) { return args; })
}));

// ulid — first two calls return deterministic IDs; subsequent calls fall back.
vi.mock("ulid", () => ({
  ulid: vi
    .fn()
    .mockReturnValueOnce("EXPENSE-ULID-001")
    .mockReturnValueOnce("SCAN-ULID-001")
    .mockImplementation(() => "ULID-FALLBACK"),
}));

// ─── Vitest + type imports ────────────────────────────────────────────────────
// These must appear after vi.mock() blocks (or at the very least, Vitest's
// transform will hoist the vi.mock calls above them automatically).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { S3Event } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { TextractClient, StartExpenseAnalysisCommand } from "@aws-sdk/client-textract";

// ─── Subject under test ───────────────────────────────────────────────────────
import { handler } from "../../src/lambdas/receipts/index.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────
import {
  makeApiEvent,
  TEST_USER_ID
} from "../__helpers__/localstack-client.js";

// ─── Env setup ────────────────────────────────────────────────────────────────
// Re-assert on every test so the suite is runnable in isolation
// (vitest.setup.unit.ts may already set these globally).
const TABLE_NAME_MAIN         = process.env.TABLE_NAME_MAIN;
const EVENT_BUS_NAME          = process.env.EVENT_BUS_NAME;
const BUCKET_RECEIPTS_NAME    = process.env.BUCKET_RECEIPTS_NAME ?? "costscrunch-dev-receipts-000000000000";

let snsTopic: string;
let snsRole: string;

beforeAll(() => {
  // Safe to read process.env here — setupFiles have already run
  snsTopic = process.env.TEXTRACT_SNS_TOPIC_ARN!;
  snsRole  = process.env.TEXTRACT_ROLE_ARN!;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Event factories ──────────────────────────────────────────────────────────

/**
 * Wraps localstack-client's makeApiEvent with receipt-specific defaults.
 * Only pass overrides that differ from the happy-path POST /receipts/upload-url.
 */
function makeUploadUrlEvent(
  overrides: Partial<{
    contentType: string;
    filename:    string;
    userId:      string;
    headers:     Record<string, string>;
  }> = {}
) {
  const { contentType = "image/jpeg", filename = "receipt.jpg", ...rest } = overrides;
  return makeApiEvent({
    routeKey: "POST /receipts/upload-url",
    method:   "POST",
    path:     "/receipts/upload-url",
    body:     { contentType, filename },
    ...rest,
  });
}

function makeS3Event(keyOverride?: string): S3Event {
  const key = keyOverride ?? `receipts/${TEST_USER_ID}/expense-001/scan-001/receipt.jpg`;
  return {
    Records: [
      {
        eventSource:       "aws:s3",
        eventName:         "ObjectCreated:Put",
        awsRegion:         "us-east-1",
        eventTime:         "2025-01-01T00:00:00.000Z",
        eventVersion:      "2.1",
        userIdentity:      { principalId: TEST_USER_ID },
        requestParameters: { sourceIPAddress: "1.2.3.4" },
        responseElements:  { "x-amz-request-id": "req-1", "x-amz-id-2": "id2" },
        s3: {
          s3SchemaVersion: "1.0",
          configurationId: "test",
          bucket: {
            name:          BUCKET_RECEIPTS_NAME,
            ownerIdentity: { principalId: "owner" },
            arn:           `arn:aws:s3:::${BUCKET_RECEIPTS_NAME}`,
          },
          object: {
            key,
            size:      204800,
            eTag:      "abc123",
            sequencer: "001",
          },
        },
      },
    ],
  };
}

// ─── UNIT: Router ─────────────────────────────────────────────────────────────
describe("Router — event-shape dispatch", () => {
  it("routes POST /receipts/upload-url to handleUploadUrl", async () => {
    // mockCreatePresignedPost already has a default resolved value from vi.hoisted.
    const result = await handler(makeUploadUrlEvent());
    expect(result).toMatchObject({ statusCode: 200 });
  });

  it("returns 404 for an unmatched API Gateway routeKey", async () => {
    const result = await handler(
      makeApiEvent({ routeKey: "GET /receipts", method: "GET", path: "/receipts", headers: {} })
    );
    expect(result).toMatchObject({ statusCode: 404 });
    expect(JSON.parse((result as any).body).error).toBe("Not found");
  });

  it("returns 400 for a completely unknown event shape", async () => {
    const result = await handler({ completely: "unknown" } as any);
    expect(result).toMatchObject({ statusCode: 400 });
    expect(JSON.parse((result as any).body).error).toBe("Unknown event type");
  });
});

// ─── UNIT: handleUploadUrl ────────────────────────────────────────────────────
describe("handleUploadUrl", () => {
  it("returns 401 when JWT authorizer claims are absent", async () => {
    const event = makeUploadUrlEvent();
    (event.requestContext as any).authorizer = undefined;

    const result = await handler(event);
    expect(result).toMatchObject({ statusCode: 401 });
    expect(JSON.parse((result as any).body).error).toBe("Unauthorized");
  });

  it("returns 400 for a disallowed MIME type", async () => {
    const result = await handler(makeUploadUrlEvent({ contentType: "image/gif" }));
    expect(result).toMatchObject({ statusCode: 400 });
    expect(JSON.parse((result as any).body).error).toMatch(/Invalid file type/);
  });

  it.each(["image/jpeg", "image/png", "application/pdf"])(
    "accepts allowed MIME type: %s",
    async (contentType) => {
      const ext = contentType === "application/pdf" ? "pdf" : "jpg";
      const result = await handler(makeUploadUrlEvent({ contentType, filename: `receipt.${ext}` }));
      expect(result).toMatchObject({ statusCode: 200 });
    }
  );

  it("passes correct bucket, size-limit, and Content-Type conditions to createPresignedPost", async () => {
    await handler(makeUploadUrlEvent());

    // createPresignedPost IS mockCreatePresignedPost — same function reference.
    expect(createPresignedPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket:     BUCKET_RECEIPTS_NAME,
        Conditions: expect.arrayContaining([
          ["content-length-range", 1, 10 * 1024 * 1024],
          ["eq", "$Content-Type", "image/jpeg"],
        ]),
        Expires: 900,
      })
    );
  });

  it("embeds userId in x-amz-meta-userid presign field", async () => {
    await handler(makeUploadUrlEvent());

    expect(createPresignedPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Fields: expect.objectContaining({ "x-amz-meta-userid": TEST_USER_ID }),
      })
    );
  });

  it("response body contains url, fields, key, expenseId, and scanId", async () => {
    mockCreatePresignedPost.mockResolvedValueOnce({
      url:    "https://s3.amazonaws.com/bucket",
      fields: { policy: "abc" },
    });

    const result = await handler(makeUploadUrlEvent());
    const body   = JSON.parse((result as any).body);

    expect(body).toMatchObject({
      url:       "https://s3.amazonaws.com/bucket",
      fields:    { policy: "abc" },
      expenseId: expect.any(String),
      scanId:    expect.any(String),
      key:       expect.stringMatching(new RegExp(`^receipts/${TEST_USER_ID}/`)),
    });
  });

  it("key follows receipts/{userId}/{expenseId}/{scanId}/{filename} format", async () => {
    const result = await handler(makeUploadUrlEvent());
    const { key } = JSON.parse((result as any).body);
    const parts   = key.split("/");

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("receipts");
    expect(parts[1]).toBe(TEST_USER_ID);
    expect(parts[4]).toBe("receipt.jpg");
  });

  it("returns 500 when createPresignedPost throws", async () => {
    mockCreatePresignedPost.mockRejectedValueOnce(new Error("S3 unavailable"));

    const result = await handler(makeUploadUrlEvent());
    expect(result).toMatchObject({ statusCode: 500 });
    expect(JSON.parse((result as any).body).error).toBe("Failed to generate upload URL");
  });
});

// ─── UNIT: S3 initiation pipeline ────────────────────────────────────────────
describe("S3 handler — key validation", () => {
  it("skips records whose key does not start with receipts/", async () => {
    await expect(
      handler(makeS3Event(`uploads/${TEST_USER_ID}/file.jpg`))
    ).resolves.toBeUndefined();

    // DDB and Textract must not be called for invalid keys.
    expect(mockDynamoDbSend).not.toHaveBeenCalled();
    expect(mockTextractSend).not.toHaveBeenCalled();
  });

  it("skips records with fewer than 5 key segments", async () => {
    await expect(
      handler(makeS3Event(`receipts/${TEST_USER_ID}/expense-001`))
    ).resolves.toBeUndefined();

    expect(mockDynamoDbSend).not.toHaveBeenCalled();
    expect(mockTextractSend).not.toHaveBeenCalled();
  });

  it("writes a DynamoDB scan record with status 'processing' for a valid key", async () => {
    await handler(makeS3Event());

    // PutCommand receives the item as its sole constructor argument (mocked as
    // an identity function), so mock.calls[0][0] is the raw { TableName, Item }.
    const putArg = vi.mocked(PutCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Item?.status).toBe("processing");
    expect(putArg?.Item?.userId).toBe(TEST_USER_ID);
    expect(putArg?.TableName).toBe(TABLE_NAME_MAIN);
  });

  it("resolves MIME type to application/pdf for .pdf keys", async () => {
    await handler(
      makeS3Event(`receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.pdf`)
    );

    const putArg = vi.mocked(PutCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Item?.mimeType).toBe("application/pdf");
  });

  it("resolves MIME type to image/jpeg for non-pdf keys", async () => {
    await handler(
      makeS3Event(`receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`)
    );

    const putArg = vi.mocked(PutCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Item?.mimeType).toBe("image/jpeg");
  });

  it("starts a Textract job with the correct bucket and key", async () => {
    const key = `receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.jpg`;
    await handler(makeS3Event(key));

    const startArg = vi.mocked(StartExpenseAnalysisCommand).mock.calls[0]?.[0] as any;
    expect(startArg?.DocumentLocation?.S3Object).toMatchObject({
      Bucket: BUCKET_RECEIPTS_NAME,
      Name:   key, 
    });
  });

  it("passes SNS topic ARN and role ARN to Textract notification channel", async () => {
    await handler(makeS3Event());

    const startArg = vi.mocked(StartExpenseAnalysisCommand).mock.calls[0]?.[0];
    expect(startArg).toBeDefined();
    expect(startArg?.NotificationChannel).toEqual({
      SNSTopicArn: snsTopic,
      RoleArn:     snsRole
    });
  });

  it("tags the Textract job with expenseId/scanId from the S3 key", async () => {
    await handler(
      makeS3Event(`receipts/${TEST_USER_ID}/expense-001/scan-001/receipt.jpg`)
    );

    const startArg = vi.mocked(StartExpenseAnalysisCommand).mock.calls[0]?.[0] as any;
    expect(startArg?.JobTag).toBe("expense-001/scan-001");
  });
});