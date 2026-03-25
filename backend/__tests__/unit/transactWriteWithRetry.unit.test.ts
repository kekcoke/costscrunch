// ─── transactWriteWithRetry — Unit Tests ──────────────────────────────────────
// Tests retry logic, error discrimination, and backoff timing.

import { describe, it, expect, vi } from "vitest";
import { transactWriteWithRetry } from "../../src/utils/transactWriteWithRetry.js";
import type { DynamoDBDocumentClient, TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake DDB client that records calls and can be configured to fail. */
function createFakeClient() {
  const calls: TransactWriteCommandInput[] = [];
  let failCount = 0;
  let failWith: Error | null = null;
  let callIndex = 0;

  const client = {
    send: vi.fn(async (cmd: any) => {
      calls.push(cmd.input);
      callIndex++;

      if (failWith && callIndex <= failCount) {
        throw failWith;
      }

      return {};
    }),
  } as unknown as DynamoDBDocumentClient;

  return {
    client,
    getCalls: () => calls,
    setFail: (error: Error, count: number) => {
      failWith = error;
      failCount = count;
      callIndex = 0;
    },
  };
}

function makeParams(): TransactWriteCommandInput {
  return {
    TransactItems: [
      {
        Put: {
          TableName: "test-table",
          Item: { pk: "A", sk: "1", val: "hello" },
        },
      },
    ],
  };
}

function transactionConflict(): Error {
  const e = new Error("Transaction conflict");
  e.name = "TransactionConflictException";
  return e;
}

function transactionCanceledWithConditional(): Error {
  const e = new Error("Transaction cancelled");
  e.name = "TransactionCanceledException";
  (e as any).CancellationReasons = [{ Code: "ConditionalCheckFailed" }];
  return e;
}

function transactionCanceledWithConflict(): Error {
  const e = new Error("Transaction cancelled");
  e.name = "TransactionCanceledException";
  (e as any).CancellationReasons = [{ Code: "TransactionConflict" }];
  return e;
}

function transactionCanceledMixed(): Error {
  const e = new Error("Transaction cancelled");
  e.name = "TransactionCanceledException";
  (e as any).CancellationReasons = [
    { Code: "TransactionConflict" },
    { Code: "ConditionalCheckFailed" },
  ];
  return e;
}

function genericError(): Error {
  return new Error("Something else");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════════
describe("happy path", () => {
  it("sends TransactWriteCommand on first attempt", async () => {
    const { client, getCalls } = createFakeClient();

    await transactWriteWithRetry(client, makeParams());

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(getCalls()).toHaveLength(1);
  });

  it("passes through the TransactItems unchanged", async () => {
    const { client, getCalls } = createFakeClient();
    const params = makeParams();

    await transactWriteWithRetry(client, params);

    expect(getCalls()[0].TransactItems).toEqual(params.TransactItems);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retry on TransactionConflictException
// ═══════════════════════════════════════════════════════════════════════════════
describe("retry on TransactionConflictException", () => {
  it("retries once and succeeds on second attempt", async () => {
    const { client, getCalls, setFail } = createFakeClient();
    setFail(transactionConflict(), 1);

    await transactWriteWithRetry(client, makeParams());

    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times and succeeds on 4th attempt", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionConflict(), 3);

    await transactWriteWithRetry(client, makeParams());

    expect(client.send).toHaveBeenCalledTimes(4); // 3 failures + 1 success
  });

  it("throws after exhausting 3 retries", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionConflict(), 10); // more than max retries

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Transaction conflict");

    expect(client.send).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Retry on TransactionCanceledException with pure conflict reasons
// ═══════════════════════════════════════════════════════════════════════════════
describe("retry on TransactionCanceledException (conflict only)", () => {
  it("retries when all CancellationReasons are TransactionConflict", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionCanceledWithConflict(), 2);

    await transactWriteWithRetry(client, makeParams());

    expect(client.send).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No retry on ConditionalCheckFailedException
// ═══════════════════════════════════════════════════════════════════════════════
describe("no retry on ConditionalCheckFailedException", () => {
  it("throws immediately on TransactionCanceledException with ConditionalCheckFailed", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionCanceledWithConditional(), 10);

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Transaction cancelled");

    expect(client.send).toHaveBeenCalledTimes(1); // no retries
  });

  it("throws immediately on mixed cancellation reasons", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionCanceledMixed(), 10);

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Transaction cancelled");

    expect(client.send).toHaveBeenCalledTimes(1); // mixed = not pure conflict
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// No retry on non-transaction errors
// ═══════════════════════════════════════════════════════════════════════════════
describe("no retry on generic errors", () => {
  it("throws immediately on non-retryable errors", async () => {
    const { client, setFail } = createFakeClient();
    setFail(genericError(), 10);

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Something else");

    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on non-Error values", async () => {
    const { client } = createFakeClient();
    (client as any).send.mockRejectedValue("string error");

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toBe("string error");

    expect(client.send).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Backoff timing
// ═══════════════════════════════════════════════════════════════════════════════
describe("backoff timing", () => {
  it("waits with exponential backoff between retries", async () => {
    const { client, setFail } = createFakeClient();
    setFail(transactionConflict(), 3);

    const start = Date.now();
    await transactWriteWithRetry(client, makeParams());
    const elapsed = Date.now() - start;

    // Expected delays: 100ms + 200ms + 400ms = 700ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(650); // allow small timing variance
    expect(elapsed).toBeLessThan(1500); // shouldn't be dramatically longer
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe("edge cases", () => {
  it("handles TransactionCanceledException with empty CancellationReasons", async () => {
    const { client } = createFakeClient();
    const e = new Error("Cancelled");
    e.name = "TransactionCanceledException";
    (e as any).CancellationReasons = [];
    (client as any).send.mockRejectedValue(e);

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Cancelled");

    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("handles TransactionCanceledException with no CancellationReasons property", async () => {
    const { client } = createFakeClient();
    const e = new Error("Cancelled");
    e.name = "TransactionCanceledException";
    // No CancellationReasons property at all
    (client as any).send.mockRejectedValue(e);

    await expect(transactWriteWithRetry(client, makeParams()))
      .rejects.toThrow("Cancelled");

    expect(client.send).toHaveBeenCalledTimes(1);
  });
});
