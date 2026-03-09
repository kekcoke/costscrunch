/**
 * analytics.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/receipts/index.ts
 * Env vars are provided by jest.setup.unit.ts (no LocalStack required
 * All AWS SDK clients are vi-mocked; nothing leaves the process.
 *
 * Coverage:
 *   • Router          — event-shape dispatch (API GW / S3 / unknown)
 *   • handleUploadUrl — auth, MIME validation, presign params, response shape
 *   • S3 key parsing  — prefix guard, segment count, PDF MIME detection
 *   • guessCategory   — keyword fallback when Claude is unavailable
 **/

const setup = async () => {
  const vitest = await import('vitest');
  // Use vitest functions here, e.g., vitest.beforeAll(...)
};
setup();

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { APIGatewayProxyEventV2, S3Event } from "aws-lambda";

// ─── AWS SDK mocks — must be hoisted before the handler import ─────────────────
vi.mock("@aws-sdk/s3-presigned-post", () => ({
  createPresignedPost: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  return {
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn(),
    })),
    GetObjectCommand: vi.fn(),
  };
});

vi.mock("@aws-sdk/client-textract", () => ({
  TextractClient: vi.fn().mockImplementation(() => ({ 
    send: vi.fn() 
  })),
  StartExpenseAnalysisCommand: vi.fn(),
  GetExpenseAnalysisCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({ 
    send: vi.fn() 
  })),
  InvokeModelCommand: vi.fn(),
}));
vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  UpdateCommand: vi.fn(),
  PutCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: vi.fn(() => ({ send: vi.fn() })),
  PutEventsCommand: vi.fn(),
}));

vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    appendKeys: vi.fn(),
  })),
}));

vi.mock("@aws-lambda-powertools/tracer", () => ({
  Tracer: vi.fn(() => ({
    getSegment: vi.fn(() => ({
      addNewSubsegment: vi.fn(() => ({ close: vi.fn() })),
    })),
  })),
}));

vi.mock("@aws-lambda-powertools/metrics", () => ({
  Metrics: vi.fn(() => ({ addMetric: vi.fn() })),
  MetricUnit: { Count: "Count", Milliseconds: "Milliseconds", NoUnit: "NoUnit" },
}));

// ulid produces deterministic values — first two calls seeded, rest fallback
vi.mock("ulid", () => ({
  ulid: vi
    .fn()
    .mockReturnValueOnce("EXPENSE-ULID-001")
    .mockReturnValueOnce("SCAN-ULID-001")
    .mockImplementation(() => "ULID-FALLBACK"),
}));

import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TextractClient } from "@aws-sdk/client-textract";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";

import { handler } from "../../src/lambdas/receipts/index.js";

// Pull shared constants from localstack-client so names stay in sync across
// the whole test suite even though we never actually connect to LocalStack here.
import {
  makeApiEvent,
  TEST_USER_ID,
  BUCKET_NAME,
  TABLE_NAME,
  EVENT_BUS,
} from "../__helpers__/localstack-client.js";

// ─── Env — mirrors jest.setup.unit.ts values ──────────────────────────────────
// jest.setup.unit.ts sets these globally; the beforeEach below re-asserts them
// so this file is also runnable in isolation (e.g. vitest --reporter=verbose).
beforeEach(() => {
  process.env.RECEIPTS_BUCKET  = BUCKET_NAME;
  process.env.TABLE_NAME       = TABLE_NAME;
  process.env.EVENT_BUS_NAME   = EVENT_BUS;
  process.env.TEXTRACT_SNS_TOPIC_ARN = "arn:aws:sns:us-east-1:000000000000:test-topic";
  process.env.TEXTRACT_ROLE_ARN      = "arn:aws:iam::000000000000:role/test-role";
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Internal event factories ─────────────────────────────────────────────────
/**
 * Wraps localstack-client's makeApiEvent with receipt-specific defaults.
 * Only pass overrides that differ from the happy-path POST /receipts/upload-url.
 */
function makeUploadUrlEvent(
  overrides: Partial<{
    contentType: string;
    filename: string;
    userId: string;
    headers: Record<string, string>;
  }> = {}
) {
  const { contentType = "image/jpeg", filename = "receipt.jpg", ...rest } = overrides;
  return makeApiEvent({
    routeKey: "POST /receipts/upload-url",
    method: "POST",
    path: "/receipts/upload-url",
    body: { contentType, filename },
    ...rest,
  });
}

function makeS3Event(keyOverride?: string): S3Event {
  const key = keyOverride ?? `receipts/${TEST_USER_ID}/expense-001/scan-001/receipt.jpg`;
  return {
    Records: [
      {
        eventSource:         "aws:s3",
        eventName:           "ObjectCreated:Put",
        awsRegion:           "us-east-1",
        eventTime:           "2025-01-01T00:00:00.000Z",
        eventVersion:        "2.1",
        userIdentity:        { principalId: TEST_USER_ID },
        requestParameters:   { sourceIPAddress: "1.2.3.4" },
        responseElements:    { "x-amz-request-id": "req-1", "x-amz-id-2": "id2" },
        s3: {
          s3SchemaVersion: "1.0",
          configurationId: "test",
          bucket: {
            name:          BUCKET_NAME,
            ownerIdentity: { principalId: "owner" },
            arn:           `arn:aws:s3:::${BUCKET_NAME}`,
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

// ─── Mock service helpers ─────────────────────────────────────────────────────
function makeTextractSend(jobStatus: "SUCCEEDED" | "FAILED" = "SUCCEEDED") {
  return vi
    .fn()
    .mockResolvedValueOnce({ JobId: "textract-job-123" }) // StartExpenseAnalysis
    .mockResolvedValueOnce({                               // GetExpenseAnalysis poll
      JobStatus:        jobStatus,
      StatusMessage:    jobStatus === "FAILED" ? "Bad document" : undefined,
      ExpenseDocuments: jobStatus === "SUCCEEDED" ? [mockExpenseDocument()] : [],
    })
    .mockResolvedValueOnce({                               // GetExpenseAnalysis results fetch
      ExpenseDocuments: [mockExpenseDocument()],
    });
}

function mockExpenseDocument() {
  return {
    SummaryFields: [
      { Type: { Text: "VENDOR_NAME" },         ValueDetection: { Text: "Starbucks" } },
      { Type: { Text: "TOTAL" },               ValueDetection: { Text: "$12.50" } },
      { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "2025-01-01" } },
      { Type: { Text: "TAX" },                 ValueDetection: { Text: "$1.00" } },
    ],
    LineItemGroups: [
      {
        LineItems: [
          {
            LineItemExpenseFields: [
              { Type: { Text: "ITEM" }, ValueDetection: { Text: "Latte" } },
            ],
          },
        ],
      },
    ],
  };
}

function makeBedrockSend() {
  const payload = {
    category:      "Meals",
    confidence:    92,
    suggestedTags: ["coffee", "meals"],
    policyFlags:   [],
  };
  const encoded = new TextEncoder().encode(
    JSON.stringify({ content: [{ text: JSON.stringify(payload) }] })
  );
  return vi.fn().mockResolvedValue({ body: encoded });
}


// Convenience: wire all services for a successful S3 pipeline run
function wireHappyPath() {
  vi.mocked(TextractClient).mock.results[0]!.value.send = makeTextractSend();
  vi.mocked(BedrockRuntimeClient).mock.results[0]!.value.send = makeBedrockSend();
  vi.mocked(DynamoDBDocumentClient.from).mock.results[0]!.value.send = vi.fn().mockResolvedValue({});
  vi.mocked(EventBridgeClient).mock.results[0]!.value.send = vi.fn().mockResolvedValue({});
}

// ─── UNIT: Router ─────────────────────────────────────────────────────────────
describe("Router — event-shape dispatch", () => {
  it("routes POST /receipts/upload-url to handleUploadUrl", async () => {
    vi.mocked(createPresignedPost).mockResolvedValue({
      url:    "https://s3.amazonaws.com/bucket",
      fields: {},
    });

    const result = await handler(makeUploadUrlEvent());
    expect(result).toMatchObject({ statusCode: 200 });
  });

  it("returns 404 for an unmatched API Gateway routeKey", async () => {
    const result = await handler(
      makeApiEvent({ routeKey: "GET /receipts", method: "GET", path: "/receipts", headers: { } })
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
    const event = makeUploadUrlEvent({ userId: undefined as any });
    // Simulate missing authorizer entirely
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
      vi.mocked(createPresignedPost).mockResolvedValue({
        url: "https://s3.example.com",
        fields: {},
      });
      const ext    = contentType === "application/pdf" ? "pdf" : "jpg";
      const result = await handler(makeUploadUrlEvent({ contentType, filename: `receipt.${ext}` }));
      expect(result).toMatchObject({ statusCode: 200 });
    }
  );

  it("passes correct bucket, size-limit, and Content-Type conditions to createPresignedPost", async () => {
    vi.mocked(createPresignedPost).mockResolvedValue({ url: "https://s3.example.com", fields: {} });

    await handler(makeUploadUrlEvent());

    expect(createPresignedPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket:     BUCKET_NAME,
        Conditions: expect.arrayContaining([
          ["content-length-range", 1, 10 * 1024 * 1024],
          ["eq", "$Content-Type", "image/jpeg"],
        ]),
        Expires: 900,
      })
    );
  });

  it("embeds userId in x-amz-meta-userid presign field", async () => {
    vi.mocked(createPresignedPost).mockResolvedValue({ url: "https://s3.example.com", fields: {} });

    await handler(makeUploadUrlEvent());

    expect(createPresignedPost).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Fields: expect.objectContaining({ "x-amz-meta-userid": TEST_USER_ID }),
      })
    );
  });

  it("response body contains url, fields, key, expenseId, and scanId", async () => {
    vi.mocked(createPresignedPost).mockResolvedValue({
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
    vi.mocked(createPresignedPost).mockResolvedValue({ url: "https://s3.example.com", fields: {} });

    const result = await handler(makeUploadUrlEvent());
    const { key } = JSON.parse((result as any).body);
    const parts   = key.split("/");

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("receipts");
    expect(parts[1]).toBe(TEST_USER_ID);
    expect(parts[4]).toBe("receipt.jpg");
  });

  it("returns 500 when createPresignedPost throws", async () => {
    vi.mocked(createPresignedPost).mockRejectedValue(new Error("S3 unavailable"));

    const result = await handler(makeUploadUrlEvent());
    expect(result).toMatchObject({ statusCode: 500 });
    expect(JSON.parse((result as any).body).error).toBe("Failed to generate upload URL");
  });
});

// ─── UNIT: S3 key parsing ─────────────────────────────────────────────────────
describe("S3 handler — key validation", () => {
  it("skips records whose key does not start with receipts/", async () => {
    // No Textract call should be made — handler must not throw
    await expect(
      handler(makeS3Event(`uploads/${TEST_USER_ID}/file.jpg`))
    ).resolves.toBeUndefined();
  });

  it("skips records with fewer than 5 key segments", async () => {
    await expect(
      handler(makeS3Event(`receipts/${TEST_USER_ID}/expense-001`))
    ).resolves.toBeUndefined();
  });

  it("resolves MIME type to application/pdf for .pdf keys", async () => {
    wireHappyPath();

    await handler(
      makeS3Event(`receipts/${TEST_USER_ID}/exp-001/scan-001/receipt.pdf`)
    );

    const putArg = vi.mocked(PutCommand).mock.calls[0]?.[0] as any;
    expect(putArg?.Item?.mimeType).toBe("application/pdf");
  });
});

// ─── UNIT: guessCategory keyword fallback ────────────────────────────────────
describe("guessCategory — keyword matching", () => {
  // Exercises the fallback branch that runs when Claude/Bedrock is unavailable.
  // Textract returns the given merchant; Bedrock throws every time.

  async function runWithMerchant(vendorName: string) {
    vi.mocked(TextractClient).mock.results[0]!.value.send = vi
      .fn()
      .mockResolvedValueOnce({ JobId: "job-1" })
      .mockResolvedValueOnce({
        JobStatus: "SUCCEEDED",
        ExpenseDocuments: [
          {
            SummaryFields: [
              { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: vendorName } },
              { Type: { Text: "TOTAL" },       ValueDetection: { Text: "$10.00" } },
            ],
            LineItemGroups: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        ExpenseDocuments: [
          {
            SummaryFields: [
              { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: vendorName } },
            ],
            LineItemGroups: [],
          },
        ],
      });

    vi.mocked(BedrockRuntimeClient).mock.results[0]!.value.send = vi
      .fn()
      .mockRejectedValue(new Error("Bedrock unavailable"));

    vi.mocked(DynamoDBDocumentClient.from).mock.results[0]!.value.send = vi
      .fn()
      .mockResolvedValue({});
    vi.mocked(EventBridgeClient).mock.results[0]!.value.send = vi
      .fn()
      .mockResolvedValue({});

    await handler(makeS3Event());

    const completedUpdate = vi
      .mocked(UpdateCommand)
      .mock.calls.find(
        ([arg]: any[]) => arg.ExpressionAttributeValues?.[":status"] === "completed"
      );
    return (completedUpdate as any[])[0].ExpressionAttributeValues[":ai"] as {
      category: string;
      confidence: number;
    };
  }

  it.each([
    ["Starbucks",    "Meals"],
    ["Marriott",     "Travel"],
    ["Whole Foods",  "Groceries"],
    ["GitHub",       "Software"],
    ["Staples",      "Office"],
    ["Best Buy",     "Equipment"],
    ["Unknown Corp", "Other"],
  ])('merchant "%s" → category "%s"', async (vendor, expected) => {
    const ai = await runWithMerchant(vendor);
    expect(ai.category).toBe(expected);
    expect(ai.confidence).toBe(expected === "Other" ? 50 : 85);
  });
});