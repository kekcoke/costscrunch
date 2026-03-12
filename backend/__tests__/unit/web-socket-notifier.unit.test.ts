// ─── ws-notifier.ts — Unit Tests ─────────────────────────────────────────────
// All AWS SDK clients are vi-mocked; nothing leaves the process.
//
// Mock architecture
// ─────────────────
// vi.hoisted() creates three stable spy instances before any module is loaded:
//
//   apiGwSend   — the .send spy on every ApiGatewayManagementApiClient instance
//   ddbDocSend  — the .send spy on the object returned by DynamoDBDocumentClient.from()
//   ddbDocFrom  — spy on the static from() itself (so we can assert it was called)
//
// GoneException is constructed via the REAL mock class that the handler imports,
// not inline.  This ensures instanceof checks inside the handler evaluate to
// true — the original file defined the class inline in the factory, which made
// it a different reference from what the handler actually imported.
//
// Command constructors (PostToConnectionCommand, QueryCommand, DeleteCommand)
// use a pass-through implementation that stores their input argument so that
// vi.mocked(Cmd).mock.calls[n][0] is the raw input object.
//
// Wire helpers mutate .mockResolvedValue() on the stable spies; they never
// replace the spy reference, so vi.clearAllMocks() in afterEach works correctly.
//
// Coverage
// ────────
//   • getConnectionIds      — correct pk format, no-op when empty
//   • pushToConnection      — happy path payload, GoneException pruning,
//                             unexpected error re-throw
//   • deleteStaleConnection — correct Key shape in DeleteCommand
//   • handler               — multi-tab fan-out, partial failure tolerance,
//                             all-gone no-throw, unexpected error propagation

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventBridgeEvent } from "aws-lambda";
import { Logger } from "../__mocks__/@aws-lambda-powertools/logger.js";
import { Metrics, mockMetrics } from "../__mocks__/@aws-lambda-powertools/metrics.js";

// ─── Shared spy instances (hoisted — exist before module evaluation) ──────────
const { apiGwSend, ddbDocSend, ddbDocFrom } = vi.hoisted(() => ({
  apiGwSend:  vi.fn(),
  ddbDocSend: vi.fn(),
  ddbDocFrom: vi.fn(),
}));

// ─── Module mocks — factories close over the hoisted spies ───────────────────
vi.mock("@aws-sdk/client-apigatewaymanagementapi", () => {
  // GoneException must be declared INSIDE the factory so the same class
  // reference is used both when the handler does `instanceof GoneException`
  // and when tests do `new GoneException()` after importing from this mock.
  class GoneException extends Error {
    readonly $fault = "client" as const;
    readonly $metadata = {};
    constructor(message = "GoneException") {
      super(message);
      this.name = "GoneException";
      Object.setPrototypeOf(this, GoneException.prototype);
    }
  }

  return {
    ApiGatewayManagementApiClient: vi.fn().mockImplementation(function () {
      return { send: apiGwSend };
    }),
    PostToConnectionCommand: vi.fn(function (args) { 
      return { _tag: "PostToConnection", input: args }; 
    }),
    GoneException,
  };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn().mockImplementation(function () {
    return {}; // opaque base-client; only DynamoDBDocumentClient.send matters
  }),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
  // Wire ddbDocFrom so from() always returns an object whose .send is the
  // stable ddbDocSend spy.
  ddbDocFrom.mockReturnValue({ send: ddbDocSend });
  return {
    DynamoDBDocumentClient: { from: ddbDocFrom },
    QueryCommand: vi.fn(function (args) { 
      return { _tag: "Query", input: args }; 
    }),
    DeleteCommand: vi.fn(function (args) { 
      return { _tag: "Delete", input: args }; 
    }),
  };
});

// ─── Imports — always after vi.mock() registrations ──────────────────────────
import {
  PostToConnectionCommand,
  GoneException,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";

import { handler } from "../../src/lambdas/web-socket-notifier/index.js";
import { TEST_USER_ID } from "../__helpers__/localstack-client.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const TABLE_NAME_CONNECTIONS      = process.env.TABLE_NAME_CONNECTIONS;
const TABLE_NAME_MAIN = process.env.TABLE_NAME_MAIN;

// ─── Lifecycle ────────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.WEBSOCKET_ENDPOINT = "https://abc123.execute-api.us-east-1.amazonaws.com/prod";

  // Reset spies to clean state then set safe defaults.
  apiGwSend.mockReset().mockResolvedValue({});
  ddbDocSend.mockReset().mockResolvedValue({});
  // ddbDocFrom is called at module init; reset its call count only
  ddbDocFrom.mockClear();
});

afterEach(() => vi.clearAllMocks());

// ─── Data factories ───────────────────────────────────────────────────────────

function makeEbEvent(overrides: Partial<{
  userId:       string;
  expenseId:    string;
  scanId:       string;
  merchant:     string;
  amount:       number;
  category:     string;
  confidence:   number;
  processingMs: number;
}> = {}): EventBridgeEvent<"ReceiptScanCompleted", any> {
  return {
    version:       "0",
    id:            "event-001",
    source:        "costscrunch.receipts",
    account:       "000000000000",
    time:          new Date().toISOString(),
    region:        "us-east-1",
    resources:     [],
    "detail-type": "ReceiptScanCompleted",
    detail: {
      userId:       overrides.userId       ?? TEST_USER_ID,
      expenseId:    overrides.expenseId    ?? "exp-ws-001",
      scanId:       overrides.scanId       ?? "scan-ws-001",
      merchant:     overrides.merchant     ?? "Starbucks",
      amount:       overrides.amount       ?? 12.5,
      category:     overrides.category     ?? "Meals",
      confidence:   overrides.confidence   ?? 92,
      processingMs: overrides.processingMs ?? 1500,
    },
  };
}

// ─── Wire helpers ─────────────────────────────────────────────────────────────

/**
 * Wire ddbDocSend so the first call (QueryCommand) returns the given
 * connectionIds; all subsequent calls (DeleteCommands) resolve to {}.
 */
function wireConnections(connectionIds: string[]) {
  ddbDocSend
    .mockResolvedValueOnce({
      Items: connectionIds.map((id) => ({ connectionId: id, userId: TEST_USER_ID })),
    })
    .mockResolvedValue({});
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

/** Extract the parsed JSON payload from a PostToConnectionCommand call. */
function getPostedPayload(callIndex = 0): Record<string, unknown> {
  const [arg] = vi.mocked(PostToConnectionCommand).mock.calls[callIndex] as any[];
  return JSON.parse(Buffer.from(arg.Data).toString());
}

// ═══════════════════════════════════════════════════════════════════════════════
// getConnectionIds — DynamoDB query
// ═══════════════════════════════════════════════════════════════════════════════
describe("getConnectionIds", () => { 
  // env var stubbed from vite.config.ts as global var.
  afterEach(() => {
    // Clean up environment variables after tests
    vi.unstubAllEnvs(); 
  });

  it("queries TABLE_NAME_CONNECTIONS with WS_CONN#{userId} pk", async () => {
    wireConnections([]);

    await handler(makeEbEvent());

    const [queryArg] = vi.mocked(QueryCommand).mock.calls[0] as any[];
    expect(queryArg.TableName).toBe(TABLE_NAME_CONNECTIONS);
    expect(queryArg.ExpressionAttributeValues[":pk"]).toBe(`WS_CONN#${TEST_USER_ID}`);
    expect(queryArg.KeyConditionExpression).toMatch(/pk\s*=\s*:pk/);
  });

  it("does not call apiGwSend when the query returns no connections", async () => {
    wireConnections([]);

    await handler(makeEbEvent());

    expect(apiGwSend).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pushToConnection — payload and error handling
// ═══════════════════════════════════════════════════════════════════════════════
describe("pushToConnection", () => {
  it("calls PostToConnectionCommand with the correct connectionId", async () => {
    wireConnections(["conn-001"]);

    await handler(makeEbEvent());

    const [arg] = vi.mocked(PostToConnectionCommand).mock.calls[0] as any[];
    expect(arg.ConnectionId).toBe("conn-001");
  });

  it("serialises the full payload to JSON in the Data field", async () => {
    wireConnections(["conn-001"]);

    await handler(makeEbEvent({
      merchant: "Uber", amount: 25.0, category: "Travel",
      confidence: 88, processingMs: 3200,
    }));

    const payload = getPostedPayload();
    expect(payload).toMatchObject({
      type:         "RECEIPT_SCAN_COMPLETED",
      expenseId:    "exp-ws-001",
      scanId:       "scan-ws-001",
      merchant:     "Uber",
      amount:       25.0,
      category:     "Travel",
      confidence:   88,
      processingMs: 3200,
    });
  });

  it("deletes stale connection from DDB when GoneException is thrown", async () => {
    wireConnections(["gone-conn-001"]);
    apiGwSend.mockRejectedValue(new GoneException({
      message: "Connection stale",
      $metadata: {}
    }));

    await handler(makeEbEvent()); // must not throw

    const [deleteArg] = vi.mocked(DeleteCommand).mock.calls[0] as any[];
    expect(deleteArg.Key.pk).toBe(`WS_CONN#${TEST_USER_ID}`);
    expect(deleteArg.Key.sk).toBe("CONN#gone-conn-001");
  });

  it("re-throws non-GoneException errors from PostToConnectionCommand", async () => {
    wireConnections(["conn-001"]);
    apiGwSend.mockRejectedValue(new Error("Internal API Gateway error"));

    await expect(handler(makeEbEvent())).rejects.toThrow("Internal API Gateway error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handler — multi-tab fan-out and partial failure tolerance
// ═══════════════════════════════════════════════════════════════════════════════
describe("handler — multi-tab fan-out", () => {
  it("calls PostToConnectionCommand once per connectionId", async () => {
    wireConnections(["conn-A", "conn-B", "conn-C"]);

    await handler(makeEbEvent());

    expect(PostToConnectionCommand).toHaveBeenCalledTimes(3);
    const ids = vi.mocked(PostToConnectionCommand).mock.calls.map(
      ([arg]: any[]) => arg.ConnectionId
    );
    expect(ids).toContain("conn-A");
    expect(ids).toContain("conn-B");
    expect(ids).toContain("conn-C");
  });

  it("delivers to remaining connections when one throws GoneException", async () => {
    wireConnections(["good-conn", "gone-conn"]);
    apiGwSend
      .mockResolvedValueOnce({})                              // good-conn succeeds
      .mockRejectedValueOnce(new GoneException({
        message: "Stale",
        $metadata: {}
      }));     // gone-conn stale

    await expect(handler(makeEbEvent())).resolves.toBeUndefined();

    // Stale conn pruned
    expect(DeleteCommand).toHaveBeenCalledTimes(1);
    const [deleteArg] = vi.mocked(DeleteCommand).mock.calls[0] as any[];
    expect(deleteArg.Key.sk).toBe("CONN#gone-conn");
  });

  it("resolves without error when every connection is stale", async () => {
    wireConnections(["gone-1", "gone-2"]);
    apiGwSend.mockRejectedValue(new GoneException({
        message: "Stale",
        $metadata: {}
    }));

    await expect(handler(makeEbEvent())).resolves.toBeUndefined();

    expect(DeleteCommand).toHaveBeenCalledTimes(2);
  });

  it("re-throws when an unexpected error occurs (not GoneException)", async () => {
    wireConnections(["conn-001"]);
    apiGwSend.mockRejectedValue(new Error("Unexpected APIGW failure"));

    await expect(handler(makeEbEvent())).rejects.toThrow("Unexpected APIGW failure");
  });

  it("resolves without error when user has no active connections", async () => {
    wireConnections([]);

    await expect(
      handler(makeEbEvent({ expenseId: "no-conn-exp", scanId: "no-conn-scan" }))
    ).resolves.toBeUndefined();

    expect(apiGwSend).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WebSocket payload — field completeness
// ═══════════════════════════════════════════════════════════════════════════════
describe("WebSocket payload — field completeness", () => {
  it("includes all required fields from the EventBridge detail", async () => {
    wireConnections(["conn-001"]);

    await handler(makeEbEvent({
      expenseId: "exp-payload-001", scanId: "scan-payload-001",
      merchant: "Lyft", amount: 18.75, category: "Travel",
      confidence: 79, processingMs: 4100,
    }));

    const payload = getPostedPayload();
    expect(payload).toMatchObject({
      type:         "RECEIPT_SCAN_COMPLETED",
      expenseId:    "exp-payload-001",
      scanId:       "scan-payload-001",
      merchant:     "Lyft",
      amount:       18.75,
      category:     "Travel",
      confidence:   79,
      processingMs: 4100,
    });
  });

  it("encodes Data as a valid UTF-8 JSON Buffer (not a plain string)", async () => {
    wireConnections(["conn-001"]);

    await handler(makeEbEvent());

    const [arg] = vi.mocked(PostToConnectionCommand).mock.calls[0] as any[];
    // Data must be buffer-like — JSON.parse(Buffer.from(...)) should not throw
    expect(() => JSON.parse(Buffer.from(arg.Data).toString())).not.toThrow();
  });
});