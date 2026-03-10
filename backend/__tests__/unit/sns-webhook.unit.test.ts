// ─── sns-webhook.ts — Unit Tests ─────────────────────────────────────────────
// All AWS SDK clients are vi-mocked; nothing leaves the process.
//
// Mock architecture
// ─────────────────
// vi.hoisted() creates one shared spy per client method BEFORE any module is
// evaluated. The vi.mock() factory then wires those spies into the returned
// constructor/factory so that:
//
//   • Every import of a client (TextractClient, etc.) gets back the same object
//     whose .send is the single hoisted spy — no ".mock.results[0]" fishing.
//   • afterEach vi.clearAllMocks() resets call-counts on the stable spy without
//     losing the reference (unlike replacing .mock.results[0]!.value.send).
//   • Wire helpers call .mockResolvedValue() on the spy — never replace it.
//
// DynamoDBDocumentClient.from is a *static factory*, not a constructor. Its spy
// (ddbDocSend) is hoisted separately and wired into the object that from()
// returns, so QueryCommand / UpdateCommand assertions always find call records.
//
// Command constructors (UpdateCommand, PutEventsCommand, etc.) are given a
// pass-through implementation that stores their input argument. This means
// vi.mocked(UpdateCommand).mock.calls[n][0] is the raw input object, not the
// class instance, which makes assertions simpler and avoids prototype leakage.
//
// Coverage
// ────────
//   • SNS message parsing  — SUCCEEDED, FAILED, custom JobTag, userId extraction
//   • parseExpenseDocuments — all summary field types, line-item extraction
//   • guessCategory        — all 7 keyword buckets + "Other" fallback
//   • enrichWithClaude     — happy path, malformed JSON fallback, Bedrock error
//   • writeScanCompleted   — scan record + parent expense back-fill
//   • writeScanFailed      — marks status=failed
//   • emitScanCompleted    — EventBridge PutEvents shape + env var usage
//   • handler              — SUCCEEDED, FAILED, Bedrock fallback, pipeline errors

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SNSEvent } from "aws-lambda";

// ─── Shared spy instances (hoisted — exist before any module evaluation) ──────
const {
  textractSend,
  bedrockSend,
  ddbDocSend,
  ebSend,
} = vi.hoisted(() => ({
  textractSend: vi.fn().mockResolvedValue({ JobId: "textract-job-123" }),
  bedrockSend:  vi.fn().mockResolvedValue({}),
  ddbDocSend:   vi.fn().mockResolvedValue({}),
  ebSend:       vi.fn().mockResolvedValue({}),
}));

// ─── Module mocks — factories close over the hoisted spies ───────────────────
vi.mock("@aws-sdk/client-textract", () => ({
  TextractClient: vi.fn().mockImplementation(function () {
    return { send: textractSend };
  }),
  // Store input so assertions can inspect what was passed to GetExpenseAnalysis
  GetExpenseAnalysisCommand: vi.fn(function(args) {
    return { _tag: "GetExpenseAnalysis", input: args }
  })
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(function () {
    return { send: bedrockSend };
  }),
  InvokeModelCommand: vi.fn(function (args) {
    return { _tag: "InvokeModel", input: args };
  }),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {}; // opaque base-client; only DynamoDBDocumentClient.send matters
  }),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(function () {
      return { send: ddbDocSend };
    }),
  },
  UpdateCommand: vi.fn(function(args){
    return { _tag: "GetExpenseAnalysis", input: args };
  }),
}));

vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: vi.fn(() => ({
    info:       vi.fn(),
    warn:       vi.fn(),
    error:      vi.fn(),
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
  Metrics:    vi.fn(function() {
    return { addMetric: vi.fn() }
  }),
  MetricUnit: { Count: "Count", Milliseconds: "Milliseconds", NoUnit: "NoUnit" },
}));

vi.mock("@aws-sdk/client-eventbridge", () => ({
  EventBridgeClient: vi.fn().mockImplementation(function () {
    return { send: ebSend };          // closes over the hoisted ebSend spy ✅
  }),
  PutEventsCommand: vi.fn(function(args) {
    return { _tag: "PutEvents", input: args };
  }),
}));

// ─── Imports — always after vi.mock() registrations ──────────────────────────
import { UpdateCommand }   from "@aws-sdk/lib-dynamodb";
import { PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { handler } from "../../src/lambdas/sns-webhook/index.js";
import { TABLE_NAME, EVENT_BUS, TEST_USER_ID } from "../__helpers__/localstack-client.js"
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { mockLogger } from "../__mocks__/@aws-lambda-powertools/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const EXPENSE_ID   = "exp-unit-001";
const SCAN_ID      = "scan-unit-001";
const TEXTRACT_JOB = "textract-job-unit-001";

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.TABLE_NAME     = TABLE_NAME;
  process.env.EVENT_BUS_NAME = EVENT_BUS;

  // mockReset() clears call history + removes any mock implementation, then we
  // set safe defaults so tests that don't call a specific wire helper don't get
  // unhandled rejections from unrelated spies.
  textractSend.mockReset().mockResolvedValue({ ExpenseDocuments: [] });
  bedrockSend.mockReset().mockResolvedValue(makeBedrockBody());
  ddbDocSend.mockReset().mockResolvedValue({});
  ebSend.mockReset().mockResolvedValue({});
});

afterEach(() => vi.clearAllMocks());

// ─── Data factories ───────────────────────────────────────────────────────────

/** Encode a Bedrock response body exactly as the real SDK returns it. */
function makeBedrockBody(payload: object = {
  category: "Meals", confidence: 92, suggestedTags: ["coffee"], policyFlags: [],
}): { body: Uint8Array } {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ text: JSON.stringify(payload) }] })
    ),
  };
}

/** Standard Textract expense docs — all summary field types + line items. */
function makeTextractDocs() {
  return [{
    SummaryFields: [
      { Type: { Text: "VENDOR_NAME" },          ValueDetection: { Text: "Starbucks" } },
      { Type: { Text: "TOTAL" },                ValueDetection: { Text: "$12.50" } },
      { Type: { Text: "SUBTOTAL" },             ValueDetection: { Text: "$11.50" } },
      { Type: { Text: "TAX" },                  ValueDetection: { Text: "$1.00" } },
      { Type: { Text: "GRATUITY" },             ValueDetection: { Text: "$0.00" } },
      { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "2025-06-01" } },
      { Type: { Text: "RECEIVER_ADDRESS" },     ValueDetection: { Text: "123 Main St" } },
      { Type: { Text: "PAYMENT_TERMS" },        ValueDetection: { Text: "NET30" } },
    ],
    LineItemGroups: [{
      LineItems: [
        { LineItemExpenseFields: [{ Type: { Text: "ITEM" }, ValueDetection: { Text: "Latte" } }] },
        { LineItemExpenseFields: [{ Type: { Text: "ITEM" }, ValueDetection: { Text: "Muffin" } }] },
        { LineItemExpenseFields: [{ Type: { Text: "QTY" },  ValueDetection: { Text: "1" } }] },
      ],
    }],
  }];
}

/** Build a well-formed SNS event wrapping a Textract completion notification. */
function makeSnsEvent(overrides: Partial<{
  JobId:   string;
  Status:  "SUCCEEDED" | "FAILED";
  JobTag:  string;
  s3Key:   string;
}> = {}): SNSEvent {
  const body = {
    JobId:  overrides.JobId  ?? TEXTRACT_JOB,
    Status: overrides.Status ?? "SUCCEEDED",
    JobTag: overrides.JobTag ?? `${EXPENSE_ID}/${SCAN_ID}`,
    DocumentLocation: {
      S3ObjectName: overrides.s3Key
        ?? `receipts/${TEST_USER_ID}/${EXPENSE_ID}/${SCAN_ID}/receipt.jpg`,
      S3Bucket: "costscrunch-dev-receipts-000000000000",
    },
  };
  return {
    Records: [{
      EventSource:          "aws:sns",
      EventVersion:         "1.0",
      EventSubscriptionArn: "arn:aws:sns:us-east-1:000:test:sub",
      Sns: {
        Type:              "Notification",
        MessageId:         "msg-001",
        TopicArn:          "arn:aws:sns:us-east-1:000:test",
        Subject:           null as any,
        Message:           JSON.stringify(body),
        Timestamp:         new Date().toISOString(),
        SignatureVersion:  "1",
        Signature:         "FAKE",
        SigningCertUrl:    "https://example.com/cert",
        UnsubscribeUrl:    "https://example.com/unsub",
        MessageAttributes: {},
      },
    }],
  };
}

// ─── Wire helpers — configure shared spies for each scenario ─────────────────

/** Happy path: real Textract docs + Bedrock enrichment. */
function wireSuccess() {
  textractSend.mockResolvedValue({ ExpenseDocuments: makeTextractDocs() });
  bedrockSend.mockResolvedValue(makeBedrockBody());
  // ddbDocSend + ebSend already default to {} from beforeEach
}

/** Textract call throws so the scan should be marked failed. */
function wireTextractError(message = "Textract error") {
  textractSend.mockRejectedValue(new Error(message));
}

/**
 * Bedrock call rejects; Textract still succeeds.
 * Handler should fall back to guessCategory and still mark scan completed.
 */
function wireBedrockError(message = "Bedrock throttled") {
  textractSend.mockResolvedValue({ ExpenseDocuments: makeTextractDocs() });
  bedrockSend.mockRejectedValue(new Error(message));
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/**
 * Find a UpdateCommand call by its :status ExpressionAttributeValue.
 * Returns the constructor's first argument (the raw input object).
 */
function findUpdateByStatus(status: "completed" | "failed") {
  return vi.mocked(UpdateCommand).mock.calls.find(
    ([arg]: any[]) => arg.ExpressionAttributeValues?.[":status"] === status
  );
}

/** Find a UpdateCommand call whose Key.pk starts with the given prefix. */
function findUpdateByPkPrefix(prefix: string) {
  return vi.mocked(UpdateCommand).mock.calls.find(
    ([arg]: any[]) => (arg.Key?.pk as string)?.startsWith(prefix)
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SNS message parsing
// ═══════════════════════════════════════════════════════════════════════════════
describe("SNS message parsing", () => {
  it("does not call Textract when status is FAILED", async () => {
    await handler(makeSnsEvent({ Status: "FAILED" }));

    expect(textractSend).not.toHaveBeenCalled();
  });

  it("marks scan as failed in DDB when Textract status is FAILED", async () => {
    await handler(makeSnsEvent({ Status: "FAILED" }));

    const call = findUpdateByStatus("failed");
    expect(call).toBeDefined();
    const [arg] = call as any[];
    expect(arg.ExpressionAttributeValues[":status"]).toBe("failed");
  });

  it("extracts expenseId and scanId from JobTag (slash-separated)", async () => {
    wireSuccess();

    await handler(makeSnsEvent({ JobTag: "custom-exp/custom-scan" }));

    const call = findUpdateByStatus("completed");
    expect(call).toBeDefined();
    const [arg] = call as any[];
    expect(arg.Key.pk).toBe("RECEIPT#custom-exp");
    expect(arg.Key.sk).toBe("SCAN#custom-scan");
  });

  it("extracts userId from S3 key segment at index [1]", async () => {
    wireSuccess();

    await handler(makeSnsEvent({ s3Key: "receipts/my-user/exp/scan/file.jpg" }));

    const call = findUpdateByPkPrefix("USER#");
    expect(call).toBeDefined();
    const [arg] = call as any[];
    expect(arg.Key.pk).toBe("USER#my-user");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// parseExpenseDocuments — summary field mapping
// ═══════════════════════════════════════════════════════════════════════════════
describe("parseExpenseDocuments — summary field mapping", () => {
  /**
   * Run a full handler call with controlled Textract output and return the
   * ExpressionAttributeValues from the "completed" UpdateCommand.
   */
  async function runWithDocs(docs: object[]) {
    textractSend.mockResolvedValue({ ExpenseDocuments: docs });
    // bedrockSend already set to valid response from beforeEach

    await handler(makeSnsEvent());

    const call = findUpdateByStatus("completed");
    return (call as any[])[0].ExpressionAttributeValues;
  }

  it("maps VENDOR_NAME → extracted.merchant", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    expect(vals[":data"].merchant).toBe("Starbucks");
  });

  it("strips currency symbols and parses TOTAL as a float", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    expect(vals[":data"].total).toBe(12.5);
  });

  it("puts ITEM line items into lineItems array", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    const descs = vals[":data"].lineItems.map((l: any) => l.description);
    expect(descs).toContain("Latte");
    expect(descs).toContain("Muffin");
  });

  it("excludes non-ITEM line item fields (e.g. QTY)", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    const descs = vals[":data"].lineItems.map((l: any) => l.description);
    expect(descs).not.toContain("1");
  });

  it("maps TAX, SUBTOTAL, GRATUITY, RECEIVER_ADDRESS, INVOICE_RECEIPT_DATE", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    expect(vals[":data"].tax).toBe(1.0);
    expect(vals[":data"].subtotal).toBe(11.5);
    expect(vals[":data"].tip).toBe(0);
    expect(vals[":data"].merchantAddress).toBe("123 Main St");
    expect(vals[":data"].date).toBe("2025-06-01");
  });

  it("silently ignores unknown field types (e.g. PAYMENT_TERMS)", async () => {
    const vals = await runWithDocs(makeTextractDocs());
    expect(vals[":data"].paymentTerms).toBeUndefined();
  });

  it("returns empty lineItems and no merchant when docs array is empty", async () => {
    const vals = await runWithDocs([]);
    expect(vals[":data"].lineItems).toHaveLength(0);
    expect(vals[":data"].merchant).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// guessCategory — keyword fallback
// ═══════════════════════════════════════════════════════════════════════════════
describe("guessCategory — keyword fallback", () => {
  /**
   * Force Bedrock to error so the handler always uses guessCategory,
   * then return the :ai value from the completed UpdateCommand.
   */
  async function runWithMerchant(vendorName: string) {
    textractSend.mockResolvedValue({
      ExpenseDocuments: [{
        SummaryFields: [
          { Type: { Text: "VENDOR_NAME" }, ValueDetection: { Text: vendorName } },
          { Type: { Text: "TOTAL" },       ValueDetection: { Text: "$10.00" } },
        ],
        LineItemGroups: [],
      }],
    });
    bedrockSend.mockRejectedValue(new Error("Bedrock unavailable"));

    await handler(makeSnsEvent());

    const call = findUpdateByStatus("completed");
    return (call as any[])[0].ExpressionAttributeValues[":ai"] as {
      category:   string;
      confidence: number;
    };
  }

  it.each([
    ["Starbucks",    "Meals",      85],
    ["Marriott",     "Travel",     85],
    ["Whole Foods",  "Groceries",  85],
    ["GitHub",       "Software",   85],
    ["Staples",      "Office",     85],
    ["Best Buy",     "Equipment",  85],
    ["Unknown Corp", "Other",      50],
  ])('merchant "%s" → category "%s" (confidence %i)', async (vendor, category, confidence) => {
    const ai = await runWithMerchant(vendor);
    expect(ai.category).toBe(category);
    expect(ai.confidence).toBe(confidence);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// enrichWithClaude
// ═══════════════════════════════════════════════════════════════════════════════
describe("enrichWithClaude", () => {
  it("uses Claude's category and confidence when Bedrock succeeds", async () => {
    wireSuccess();

    await handler(makeSnsEvent());

    const call = findUpdateByStatus("completed");
    const ai   = (call as any[])[0].ExpressionAttributeValues[":ai"];
    expect(ai.category).toBe("Meals");
    expect(ai.confidence).toBe(92);
    expect(ai.suggestedTags).toContain("coffee");
  });

  it("falls back to guessCategory when Bedrock response body is malformed JSON", async () => {
    textractSend.mockResolvedValue({ ExpenseDocuments: makeTextractDocs() });
    bedrockSend.mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ text: "not-valid-json{{{{" }] })
      ),
    });

    await expect(handler(makeSnsEvent())).resolves.toBeUndefined();

    const call = findUpdateByStatus("completed");
    const ai   = (call as any[])[0].ExpressionAttributeValues[":ai"];
    // Starbucks in docs → Meals via keyword fallback, confidence 85
    expect(ai.category).toBe("Meals");
    expect(ai.confidence).toBe(85);
  });

  it("falls back to guessCategory when bedrockSend rejects", async () => {
    wireBedrockError();

    await expect(handler(makeSnsEvent())).resolves.toBeUndefined();

    const call = findUpdateByStatus("completed");
    expect(call).toBeDefined();
    const ai = (call as any[])[0].ExpressionAttributeValues[":ai"];
    expect(ai.category).toBe("Meals");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// writeScanCompleted — DynamoDB writes
// ═══════════════════════════════════════════════════════════════════════════════
describe("writeScanCompleted — DynamoDB writes", () => {
  beforeEach(() => wireSuccess());

  it("updates scan record: status=completed, textractJobId, processingMs, aiEnrichment", async () => {
    await handler(makeSnsEvent());

    const call = vi.mocked(UpdateCommand).mock.calls.find(
      ([arg]: any[]) =>
        (arg.Key?.pk as string)?.startsWith("RECEIPT#") &&
        arg.ExpressionAttributeValues?.[":status"] === "completed"
    );
    expect(call).toBeDefined();

    const [arg] = call as any[];
    expect(arg.ExpressionAttributeValues[":jobId"]).toBe(TEXTRACT_JOB);
    expect(typeof arg.ExpressionAttributeValues[":ms"]).toBe("number");
    expect(arg.ExpressionAttributeValues[":ai"]).toMatchObject({ category: "Meals" });
  });

  it("back-fills parent expense via USER# pk with if_not_exists", async () => {
    await handler(makeSnsEvent());

    const call = findUpdateByPkPrefix("USER#");
    expect(call).toBeDefined();

    const [arg] = call as any[];
    expect(arg.UpdateExpression).toMatch(/if_not_exists/);
    expect(arg.ExpressionAttributeValues[":merchant"]).toBe("Starbucks");
    expect(arg.ExpressionAttributeValues[":amount"]).toBe(12.5);
    expect(arg.ExpressionAttributeValues[":category"]).toBe("Meals");
  });

  it("defaults merchant to 'Unknown' and amount to 0 when Textract returns no fields", async () => {
    // Override the textractSend set by wireSuccess() in beforeEach
    textractSend.mockResolvedValue({
      ExpenseDocuments: [{ SummaryFields: [], LineItemGroups: [] }],
    });

    await handler(makeSnsEvent());

    const call = findUpdateByPkPrefix("USER#");
    const [arg] = call as any[];
    expect(arg.ExpressionAttributeValues[":merchant"]).toBe("Unknown");
    expect(arg.ExpressionAttributeValues[":amount"]).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// emitScanCompleted — EventBridge shape
// ═══════════════════════════════════════════════════════════════════════════════
describe("emitScanCompleted — EventBridge event", () => {
  beforeEach(() => wireSuccess());

  it("emits ReceiptScanCompleted with correct Source, DetailType, and Detail fields", async () => {
    await handler(makeSnsEvent());

    const [cmd]  = vi.mocked(PutEventsCommand).mock.calls[0] as any[];
    const entry  = cmd.Entries[0];

    expect(entry.Source).toBe("costscrunch.receipts");
    expect(entry.DetailType).toBe("ReceiptScanCompleted");

    const detail = JSON.parse(entry.Detail);
    expect(detail).toMatchObject({
      userId:     TEST_USER_ID,
      expenseId:  EXPENSE_ID,
      scanId:     SCAN_ID,
      merchant:   "Starbucks",
      amount:     12.5,
      category:   "Meals",
      confidence: 92,
    });
    expect(typeof detail.processingMs).toBe("number");
  });

  it("uses EVENT_BUS_NAME env var as EventBusName", async () => {
    await handler(makeSnsEvent());

    const [cmd] = vi.mocked(PutEventsCommand).mock.calls[0] as any[];
    expect(cmd.Entries[0].EventBusName).toBe(EVENT_BUS);
  });

  it("does not call ebSend when Textract status is FAILED", async () => {
    // FAILED path → writeScanFailed only; emitScanCompleted must not run
    await handler(makeSnsEvent({ Status: "FAILED" }));

    expect(ebSend).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handler — failure handling
// ═══════════════════════════════════════════════════════════════════════════════
describe("handler — failure handling", () => {
  it("marks scan failed and re-throws when Textract GetExpenseAnalysis throws", async () => {
    wireTextractError("Textract throttled");

    await expect(handler(makeSnsEvent())).rejects.toThrow("Textract throttled");

    expect(findUpdateByStatus("failed")).toBeDefined();
  });

  it("marks scan failed and re-throws when the first DDB UpdateCommand throws", async () => {
    textractSend.mockResolvedValue({ ExpenseDocuments: makeTextractDocs() });
    ddbDocSend
      .mockRejectedValueOnce(new Error("DDB throttle")) // scan=completed write
      .mockResolvedValue({});                           // writeScanFailed fallback

    await expect(handler(makeSnsEvent())).rejects.toThrow("DDB throttle");

    expect(findUpdateByStatus("failed")).toBeDefined();
  });

  it("does not emit EventBridge when the pipeline errors before emitScanCompleted", async () => {
    wireTextractError();

    await expect(handler(makeSnsEvent())).rejects.toThrow();

    expect(ebSend).not.toHaveBeenCalled();
  });

  it("processes all SNS records — FAILED record does not abort subsequent SUCCEEDED records", async () => {
    textractSend.mockResolvedValue({ ExpenseDocuments: makeTextractDocs() });

    const event: SNSEvent = {
      Records: [
        makeSnsEvent({ Status: "FAILED",    JobTag: "exp-a/scan-a" }).Records[0]!,
        makeSnsEvent({ Status: "SUCCEEDED", JobTag: "exp-b/scan-b" }).Records[0]!,
      ],
    };

    await expect(handler(event)).resolves.toBeUndefined();

    const allCalls = vi.mocked(UpdateCommand).mock.calls;

    const failedCall = allCalls.find(
      ([a]: any[]) =>
        a.Key?.pk === "RECEIPT#exp-a" &&
        a.ExpressionAttributeValues?.[":status"] === "failed"
    );
    const completedCall = allCalls.find(
      ([a]: any[]) =>
        a.Key?.pk === "RECEIPT#exp-b" &&
        a.ExpressionAttributeValues?.[":status"] === "completed"
    );

    expect(failedCall).toBeDefined();
    expect(completedCall).toBeDefined();
  });
});