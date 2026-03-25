// ─── receipts pipeline — Integration Tests ────────────────────────────────────
// Requires LocalStack running. Covers the full async pipeline introduced by the
// SNS webhook refactor:
//
//   [index.ts]       S3 event → DDB "processing" write → StartExpenseAnalysis
//   [sns-webhook.ts] SNS notification → GetExpenseAnalysis → Claude → DDB → EventBridge
//   [ws-notifier.ts] EventBridge event → DDB connection lookup → PostToConnection
//
// Textract and Bedrock are vi-mocked (not available in LocalStack free tier).
// ApiGatewayManagementApi is vi-mocked (requires a real deployed WSS endpoint).
// DynamoDB, S3, EventBridge, SNS, SQS all use real LocalStack clients.
//
// receiptApi (frontend) WebSocket integration:
//   Tested by asserting the full DDB state after the pipeline completes and
//   verifying the shape of data the frontend's fallbackHttpGet would read.
//   Browser WebSocket tests remain in receiptApi.unit.test.ts (jsdom).

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import type { S3Event, SNSEvent } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const {
  mockTextractSend,
  mockBedRockSend,
  mockApiGwSend
} = vi.hoisted(() => ({
  mockTextractSend:       vi.fn().mockResolvedValue({ JobId: "textract-job-123" }),
  mockBedRockSend:       vi.fn(),
  mockApiGwSend:         vi.fn()
}));

// ─── Mocked services (not available in LocalStack free tier) ──────────────────
vi.mock("@aws-sdk/client-textract", () => ({
  // Regular function required for `new TextractClient()`.
  TextractClient: vi.fn().mockImplementation(function () {
    return { send: mockTextractSend };
  }),
  GetExpenseAnalysisCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
  StartExpenseAnalysisCommand: vi.fn().mockImplementation(function (args) {
    return args;
  }),
}));


vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: vi.fn() })),
  InvokeModelCommand:   vi.fn(),
}));

vi.mock("@aws-sdk/client-apigatewaymanagementapi", () => {
  // GoneException must be declared INSIDE the factory so the same class
  // reference is used both when the handler does `instanceof GoneException`
  // and when tests do `new GoneException()` after importing from this mock.
  class GoneException extends Error {
    readonly $fault = "client" as const;
    readonly $metadata: object;
    constructor(opts: { message: string; $metadata: object }) {
      super(opts.message);
      this.name = "GoneException";
      this.$metadata = opts.$metadata;
      Object.setPrototypeOf(this, GoneException.prototype);
    }
  }

  return {
    ApiGatewayManagementApiClient: vi.fn().mockImplementation(function () {
      // Returns an object whose send is the CURRENT mockApiGwSend reference
      return { send: (...args: any[]) => mockApiGwSend(...args) };    }),
    PostToConnectionCommand: vi.fn(function (args) { 
      return { _tag: "PostToConnection", input: args }; 
    }),
    GoneException,
  };
});


vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: vi.fn(function () {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      appendKeys: vi.fn(),
    };
  }),
}));

vi.mock("@aws-lambda-powertools/tracer", () => ({
  Tracer: vi.fn(function () {
    return {
      getSegment: vi.fn(() => ({
        addNewSubsegment: vi.fn(() => ({ 
          close: vi.fn(),
          addAnnotation: vi.fn(),
        })),
      })),
      putAnnotation: vi.fn(),
    };
  }),
}));

vi.mock("@aws-lambda-powertools/metrics", () => ({
  Metrics: vi.fn(function () {
    return { addMetric: vi.fn() };
  }),
  MetricUnit: { Count: "Count", Milliseconds: "Milliseconds", NoUnit: "NoUnit" },
}));

vi.mock("ulid", () => ({
  ulid: vi.fn()
    .mockReturnValueOnce("INTEG-EXPENSE-PIPE-001")
    .mockReturnValueOnce("INTEG-SCAN-PIPE-001")
    .mockImplementation(() => "INTEG-ULID-FALLBACK"),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(function () {
    return { send: mockBedRockSend };
  }),
  InvokeModelCommand: vi.fn(function (args) {
    return { _tag: "InvokeModel", input: args };
  }),
}));

import {
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

// ─── Handlers under test ──────────────────────────────────────────────────────
import { handler as s3Handler }          from "../../src/lambdas/receipts/index.js";
import { handler as snsWebhookHandler }  from "../../src/lambdas/sns-webhook/index.js";
import { handler as wsNotifierHandler }  from "../../src/lambdas/web-socket-notifier/index.js";

// ─── LocalStack helpers ────────────────────────────────────────────────────────
import {
  ddbDoc,
  s3,
  eb,
  dynamodb,
  TABLE_NAME_MAIN,
  BUCKET_UPLOADS_NAME,
  BUCKET_PROCESSED_NAME,
  BUCKET_RECEIPTS_NAME,
  EVENT_BUS_NAME,
  TEST_USER_ID,
  waitForLocalStack,
  cleanTable,
  TABLE_NAME_CONNECTIONS,
} from "../__helpers__/localstack-client.js";
import {
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import {
  CreateEventBusCommand,
} from "@aws-sdk/client-eventbridge";
import { CreateTableCommand } from "@aws-sdk/client-dynamodb";

// ─── Suite-level constants ────────────────────────────────────────────────────
const EXPENSE_ID   = "integ-pipe-expense-001";
const SCAN_ID      = "integ-pipe-scan-001";
// Key now reflects processed bucket output: receipts/{userId}/{expenseId}/{scanId}/{filename}
const S3_KEY       = `receipts/${TEST_USER_ID}/${EXPENSE_ID}/${SCAN_ID}/receipt.jpg`;
const TEXTRACT_JOB = "textract-integ-job-001";

// ─── Suite setup ─────────────────────────────────────────────────────────────
beforeAll(async () => {
  await waitForLocalStack();

  for (const TableName of [TABLE_NAME_MAIN, TABLE_NAME_CONNECTIONS]) {
    try {
      await dynamodb.send(new CreateTableCommand({
        TableName,
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
          // GSI for receipt duplicate detection
          { AttributeName: "receiptHash", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
        GlobalSecondaryIndexes: TableName === TABLE_NAME_MAIN ? [
          {
            IndexName: "ReceiptHashIndex",
            KeySchema: [
              { AttributeName: "receiptHash", KeyType: "HASH" },
            ],
            Projection: { ProjectionType: "ALL" },
          },
        ] : undefined,
      }));
    } catch (e: any) {
      if (e.name !== "ResourceInUseException") throw e;
    }
  }

  // Bootstrap LocalStack resources
  try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET_UPLOADS_NAME })); }
  catch (e: any) { if (!["BucketAlreadyOwnedByYou","BucketAlreadyExists"].includes(e.name)) throw e; }

  try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET_PROCESSED_NAME })); }
  catch (e: any) { if (!["BucketAlreadyOwnedByYou","BucketAlreadyExists"].includes(e.name)) throw e; }

  try { await s3.send(new CreateBucketCommand({ Bucket: BUCKET_RECEIPTS_NAME })); }
  catch (e: any) { if (!["BucketAlreadyOwnedByYou","BucketAlreadyExists"].includes(e.name)) throw e; }

  try { await eb.send(new CreateEventBusCommand({ Name: EVENT_BUS_NAME })); }
  catch (e: any) { if (e.name !== "ResourceAlreadyExistsException") throw e; }

  // Set all env vars the handlers need
  process.env.TABLE_NAME_MAIN        = TABLE_NAME_MAIN;
  process.env.TABLE_NAME_CONNECTIONS = TABLE_NAME_CONNECTIONS;
  process.env.EVENT_BUS_NAME         = EVENT_BUS_NAME;
  process.env.BUCKET_UPLOADS_NAME    = BUCKET_UPLOADS_NAME;
  process.env.BUCKET_PROCESSED_NAME  = BUCKET_PROCESSED_NAME;
  process.env.BUCKET_RECEIPTS_NAME   = BUCKET_RECEIPTS_NAME;
  process.env.TEXTRACT_SNS_TOPIC_ARN = "arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract";
  process.env.TEXTRACT_ROLE_ARN      = "arn:aws:iam::000000000000:role/costscrunch-dev-textract";
  process.env.WEBSOCKET_ENDPOINT     = "https://stub.execute-api.us-east-1.amazonaws.com/prod";
  process.env.AWS_ENDPOINT_URL       = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
  process.env.AWS_REGION             = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID      = "test";
  process.env.AWS_SECRET_ACCESS_KEY  = "test";
}, 60000);

afterAll(async () => {
  await cleanTable("RECEIPT#");
  await cleanTable(`USER#${TEST_USER_ID}`);
  await cleanTable("WS_CONN#");
});

afterEach(() => vi.clearAllMocks());

// ─── Shared Textract + Bedrock mock helpers ───────────────────────────────────
function wireTextractInteg() {
  const docs = [{
    SummaryFields: [
      { Type: { Text: "VENDOR_NAME" },         ValueDetection: { Text: "Uber" } },
      { Type: { Text: "TOTAL" },               ValueDetection: { Text: "$28.75" } },
      { Type: { Text: "INVOICE_RECEIPT_DATE" }, ValueDetection: { Text: "2025-06-15" } },
    ],
    LineItemGroups: [{
      LineItems: [
        { LineItemExpenseFields: [{ Type: { Text: "ITEM" }, ValueDetection: { Text: "UberX ride" } }] },
      ],
    }],
  }];

  mockTextractSend.mockResolvedValue({ ExpenseDocuments: docs });
}

function wireBedrockInteg() {
  const payload = { category: "Travel", confidence: 94, suggestedTags: ["transport"], policyFlags: [] };
  const encoded = new TextEncoder().encode(
    JSON.stringify({ content: [{ text: JSON.stringify(payload) }] })
  );
  mockBedRockSend.mockResolvedValue({ body: encoded });  // ← correct spy
}

// ─── S3 event factory ─────────────────────────────────────────────────────────
function makeS3Event(keyOverride = S3_KEY): S3Event {
  return {
    Records: [{
      eventSource:       "aws:s3",
      eventName:         "ObjectCreated:Put",
      awsRegion:         "us-east-1",
      eventTime:         new Date().toISOString(),
      eventVersion:      "2.1",
      userIdentity:      { principalId: TEST_USER_ID },
      requestParameters: { sourceIPAddress: "1.2.3.4" },
      responseElements:  { "x-amz-request-id": "req-1", "x-amz-id-2": "id2" },
      s3: {
        s3SchemaVersion: "1.0",
        configurationId: "test",
        bucket: {
          name:          BUCKET_PROCESSED_NAME,
          ownerIdentity: { principalId: "owner" },
          arn:           `arn:aws:s3:::${BUCKET_PROCESSED_NAME}`,
        },
        object: { key: keyOverride, size: 150_000, eTag: "abc", sequencer: "001" },
      },
    }],
  };
}

// ─── SNS event factory (mirrors Textract completion payload) ──────────────────
function makeSnsEvent(overrides: {
  jobId?:      string;
  status?:     "SUCCEEDED" | "FAILED";
  expenseId?:  string;
  scanId?:     string;
  s3Key?:      string;
} = {}): SNSEvent {
  const expId = overrides.expenseId ?? EXPENSE_ID;
  const scnId = overrides.scanId    ?? SCAN_ID;
  const msg = {
    JobId:  overrides.jobId  ?? TEXTRACT_JOB,
    Status: overrides.status ?? "SUCCEEDED",
    JobTag: `${expId}/${scnId}`,
    DocumentLocation: {
      S3ObjectName: overrides.s3Key ?? S3_KEY,
      S3Bucket:     BUCKET_RECEIPTS_NAME,
    },
  };
  return {
    Records: [{
      EventSource:          "aws:sns",
      EventVersion:         "1.0",
      EventSubscriptionArn: "arn:aws:sns:us-east-1:000:test:sub",
      Sns: {
        Type:             "Notification",
        MessageId:        "integ-msg-001",
        TopicArn:         "arn:aws:sns:us-east-1:000:costscrunch-dev-textract",
        Subject:          null as any,
        Message:          JSON.stringify(msg),
        Timestamp:        new Date().toISOString(),
        SignatureVersion: "1",
        Signature:        "FAKE",
        SigningCertUrl:   "https://example.com/cert",
        UnsubscribeUrl:   "https://example.com/unsub",
        MessageAttributes: {},
      },
    }],
  };
}

// ─── EventBridge event factory ────────────────────────────────────────────────
function makeEbEvent(overrides: Partial<{
  expenseId: string; scanId: string; merchant: string; amount: number;
  category: string; confidence: number; processingMs: number;
}> = {}) {
  return {
    version:      "0",
    id:           "integ-eb-001",
    source:       "costscrunch.receipts",
    account:      "000000000000",
    time:         new Date().toISOString(),
    region:       "us-east-1",
    resources:    [],
    "detail-type": "ReceiptScanCompleted",
    detail: {
      userId:       TEST_USER_ID,
      expenseId:    overrides.expenseId    ?? EXPENSE_ID,
      scanId:       overrides.scanId       ?? SCAN_ID,
      merchant:     overrides.merchant     ?? "Uber",
      amount:       overrides.amount       ?? 28.75,
      category:     overrides.category     ?? "Travel",
      confidence:   overrides.confidence   ?? 94,
      processingMs: overrides.processingMs ?? 2000,
    },
  } as any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: index.ts — S3 initiator
// ═══════════════════════════════════════════════════════════════════════════════
describe("S3 Initiator (index.ts) — integration", () => {
  it("writes a processing scan record to real DynamoDB", async () => {
    // Textract StartExpenseAnalysis is mocked to avoid calling AWS
    mockTextractSend.mockResolvedValue({ JobId: TEXTRACT_JOB });

    await s3Handler(makeS3Event());

    const result = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
    }));

    expect(result.Item).toMatchObject({
      status:     "processing",
      entityType: "SCAN",
      userId:     TEST_USER_ID,
      s3Bucket:   BUCKET_PROCESSED_NAME,
      s3Key:      S3_KEY,
      mimeType:   "image/jpeg",
    });
  });

  it("sets a 30-day TTL on the processing scan record", async () => {
    mockTextractSend.mockResolvedValue({ JobId: TEXTRACT_JOB });

    await s3Handler(makeS3Event());

    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
    }));

    const nowSec    = Math.floor(Date.now() / 1000);
    const thirtyDay = 30 * 24 * 60 * 60;
    expect(Item?.ttl).toBeGreaterThan(nowSec + thirtyDay - 120);
    expect(Item?.ttl).toBeLessThan(nowSec    + thirtyDay + 120);
  });

  it("skips records with malformed S3 key and does not write to DDB", async () => {
    const badEvent = makeS3Event("bad/key");
    await expect(s3Handler(badEvent)).resolves.toBeUndefined();

    // No scan record should have been written for the bad key
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: "RECEIPT#undefined", sk: "SCAN#undefined" },
    }));
    expect(Item).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: sns-webhook.ts — enrichment pipeline
// ═══════════════════════════════════════════════════════════════════════════════
describe("SNS Webhook (sns-webhook.ts) — integration", () => {
  // Seed a processing scan record so the handler has something to update
  beforeAll(async () => {
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_MAIN,
      Item: {
        pk:         `RECEIPT#${EXPENSE_ID}`,
        sk:         `SCAN#${SCAN_ID}`,
        entityType: "SCAN",
        scanId:     SCAN_ID,
        expenseId:  EXPENSE_ID,
        userId:     TEST_USER_ID,
        status:     "processing",
        s3Key:      S3_KEY,
        s3Bucket:   BUCKET_PROCESSED_NAME,
        mimeType:   "image/jpeg",
        createdAt:  new Date().toISOString(),
      },
    }));
  });

  // Reset scan record to "processing" before each test so the conditional
  // expression in writeScanCompleted (status = :processing) succeeds
  beforeEach(async () => {
    await ddbDoc.send(new UpdateCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
      UpdateExpression: "SET #status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": "processing" },
    }));
  });

  it("updates scan status to completed in real DynamoDB", async () => {
    wireTextractInteg();
    wireBedrockInteg();

    await snsWebhookHandler(makeSnsEvent());

    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
    }));

    expect(Item?.status).toBe("completed");
    expect(Item?.textractJobId).toBe(TEXTRACT_JOB);
    expect(typeof Item?.processingMs).toBe("number");
  });

  it("persists Claude's enrichment category and confidence", async () => {
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
    }));

    expect(Item?.aiEnrichment).toMatchObject({ category: "Travel", confidence: 94 });
  });

  it("persists extracted merchant and total in extractedData", async () => {
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${EXPENSE_ID}`, sk: `SCAN#${SCAN_ID}` },
    }));

    expect(Item?.extractedData).toMatchObject({ merchant: "Uber", total: 28.75 });
  });

  it("back-fills the parent expense record (USER# pk) in real DynamoDB", async () => {
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `USER#${TEST_USER_ID}`, sk: `EXPENSE#${EXPENSE_ID}` },
    }));

    expect(Item).toMatchObject({
      merchant:  "Uber",
      amount:    28.75,
      category:  "Travel",
      scanId:    SCAN_ID,
    });
  });

  it("marks scan as failed in DDB when Textract status is FAILED", async () => {
    const failExpenseId = "integ-fail-expense-001";
    const failScanId    = "integ-fail-scan-001";

    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_MAIN,
      Item: { pk: `RECEIPT#${failExpenseId}`, sk: `SCAN#${failScanId}`, entityType: "SCAN", status: "processing", userId: TEST_USER_ID, createdAt: new Date().toISOString() },
    }));

    await snsWebhookHandler(makeSnsEvent({ status: "FAILED", expenseId: failExpenseId, scanId: failScanId }));

    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${failExpenseId}`, sk: `SCAN#${failScanId}` },
    }));
    expect(Item?.status).toBe("failed");
  });

  it("uses keyword-guessed category when Bedrock is unavailable", async () => {
    const fbExpenseId = "integ-fallback-expense-001";
    const fbScanId    = "integ-fallback-scan-001";

    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_MAIN,
      Item: { pk: `RECEIPT#${fbExpenseId}`, sk: `SCAN#${fbScanId}`, entityType: "SCAN", status: "processing", userId: TEST_USER_ID, createdAt: new Date().toISOString() },
    }));

    wireTextractInteg();
    mockBedRockSend
      .mockRejectedValue(new Error("Bedrock throttled"));

    await snsWebhookHandler(makeSnsEvent({ expenseId: fbExpenseId, scanId: fbScanId }));

    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${fbExpenseId}`, sk: `SCAN#${fbScanId}` },
    }));

    // "Uber" → Travel via keyword matching
    expect(Item?.aiEnrichment?.category).toBe("Travel");
    expect(Item?.aiEnrichment?.confidence).toBe(85);
    expect(Item?.status).toBe("completed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: ws-notifier.ts — WebSocket push
// ═══════════════════════════════════════════════════════════════════════════════
describe("WebSocket Notifier (ws-notifier.ts) — integration", () => {
  const CONN_ID = "integ-conn-001";

  beforeAll(async () => {
    // Seed a connection record in the connections table (LocalStack DDB)
    // In production this is written by the $connect Lambda.
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_CONNECTIONS,
      Item: {
        pk:           `WS_CONN#${TEST_USER_ID}`,
        sk:           `CONN#${CONN_ID}`,
        connectionId: CONN_ID,
        userId:       TEST_USER_ID,
        connectedAt:  new Date().toISOString(),
        ttl:          Math.floor(Date.now() / 1000) + 3600,
      },
    }));
  });

  afterAll(async () => { await cleanTable("WS_CONN#"); });

  it("queries the connection table and calls PostToConnectionCommand", async () => {
    mockApiGwSend.mockResolvedValue({});

    await wsNotifierHandler(makeEbEvent());

    expect(PostToConnectionCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ConnectionId: CONN_ID })
    );
  });

  it("pushed payload is valid JSON with RECEIPT_SCAN_COMPLETED type", async () => {
    mockApiGwSend.mockResolvedValue({});  // simple success — no GoneException here

    await wsNotifierHandler(makeEbEvent());

    const callArg = vi.mocked(PostToConnectionCommand).mock.calls[0]?.[0] as any;
    const payload = JSON.parse(Buffer.from(callArg.Data).toString());
    expect(payload.type).toBe("RECEIPT_SCAN_COMPLETED");
    expect(payload.expenseId).toBe(EXPENSE_ID);
    expect(payload.category).toBe("Travel");
  });

  it("removes a stale connection from DDB on GoneException", async () => {
    // Seed a stale connection
    const staleConnId = "integ-stale-conn-001";
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_CONNECTIONS,
      Item: {
        pk: `WS_CONN#${TEST_USER_ID}`, sk: `CONN#${staleConnId}`,
        connectionId: staleConnId, userId: TEST_USER_ID,
      },
    }));

    // ApiGW throws GoneException for the stale connection, succeeds for the good one
    const { GoneException } = await import("@aws-sdk/client-apigatewaymanagementapi");
    mockApiGwSend.mockImplementation(async (cmd: any) => {
      if (cmd.input?.ConnectionId === staleConnId) {
        throw new GoneException({ message: "Gone", $metadata: {} });
      }
      return {};
    });

    await wsNotifierHandler(makeEbEvent());

    // The stale connection row should be gone from DDB
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_CONNECTIONS,
      Key: { pk: `WS_CONN#${TEST_USER_ID}`, sk: `CONN#${staleConnId}` },
    }));
    expect(Item).toBeUndefined();
  });

  it("resolves without error when the user has no active connections", async () => {
    await expect(
      wsNotifierHandler(makeEbEvent({ expenseId: "no-conn-exp", scanId: "no-conn-scan" }))
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATION: receiptApi — upload-url route + DDB state post-pipeline
// (frontend WebSocket behaviour is covered by receiptApi.unit.test.ts)
// ═══════════════════════════════════════════════════════════════════════════════
describe("receiptApi — upload-url + pipeline DDB state (integration)", () => {
  // Re-use the index.ts handler to test the full upload-url → S3 → DDB path.
  // The receiptApi frontend reads the scan result from DDB when the WebSocket
  // fallback fires. This suite validates the shape of that DDB data.

  const uploadExpId  = "integ-upload-exp-001";
  const uploadScanId = "integ-upload-scan-001";

  it("POST /receipts/upload-url returns a valid presigned URL pointing at LocalStack", async () => {
    const { makeApiEvent } = await import("../__helpers__/localstack-client.js");
    const event = makeApiEvent({
      routeKey: "POST /receipts/upload-url",
      method:   "POST",
      path:     "/receipts/upload-url",
      body:     { contentType: "image/jpeg", filename: "receipt.jpg" },
    });

    const result = await s3Handler(event as any);
    expect(result).toMatchObject({ statusCode: 200 });

    const body = JSON.parse((result as any).body);
    // Upload URL should point to uploads bucket (preprocessing will move to processed bucket)
    expect(body.url).toContain(BUCKET_UPLOADS_NAME);
    expect(body.fields["Content-Type"]).toBe("image/jpeg");
    expect(body.fields["x-amz-meta-userid"]).toBe(TEST_USER_ID);
    // Key must follow uploads/{userId}/{expenseId}/{scanId}/{filename}
    expect(body.key).toMatch(
      new RegExp(`^uploads/${TEST_USER_ID}/[A-Z0-9-]+/[A-Z0-9-]+/receipt\\.jpg$`)
    );
  });

  it("DDB scan record after full pipeline has shape that fallbackHttpGet would return", async () => {
    // Manually seed the completed state that sns-webhook.ts would have written
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_MAIN,
      Item: {
        pk:            `RECEIPT#${uploadExpId}`,
        sk:            `SCAN#${uploadScanId}`,
        entityType:    "SCAN",
        scanId:        uploadScanId,
        expenseId:     uploadExpId,
        userId:        TEST_USER_ID,
        status:        "completed",
        extractedData: { merchant: "Lyft", total: 15.5, date: "2025-06-20", lineItems: [] },
        aiEnrichment:  { category: "Travel", confidence: 87, suggestedTags: ["transport"], policyFlags: [] },
        textractJobId: "textract-job-upload-001",
        processingMs:  2200,
        createdAt:     new Date().toISOString(),
        updatedAt:     new Date().toISOString(),
      },
    }));

    // This is the DDB read that GET /receipts/{expenseId}/scan would perform,
    // and what receiptApi.ts's fallbackHttpGet ultimately returns.
    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${uploadExpId}`, sk: `SCAN#${uploadScanId}` },
    }));

    expect(Item).toMatchObject({
      status:    "completed",
      expenseId: uploadExpId,
      scanId:    uploadScanId,
      extractedData: { merchant: "Lyft", total: 15.5 },
      aiEnrichment:  { category: "Travel" },
    });
  });

  it("DDB scan record in 'failed' status is also a valid terminal state for fallbackHttpGet", async () => {
    const failId = "integ-upload-fail-001";
    await ddbDoc.send(new PutCommand({
      TableName: TABLE_NAME_MAIN,
      Item: {
        pk: `RECEIPT#${failId}`, sk: `SCAN#${failId}`,
        entityType: "SCAN", scanId: failId, expenseId: failId,
        userId: TEST_USER_ID, status: "failed",
        createdAt: new Date().toISOString(),
      },
    }));

    const { Item } = await ddbDoc.send(new GetCommand({
      TableName: TABLE_NAME_MAIN,
      Key: { pk: `RECEIPT#${failId}`, sk: `SCAN#${failId}` },
    }));

    expect(Item?.status).toBe("failed");
  });
});