/**
 * expenses.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/expenses/index.ts
 * Uses aws-sdk-client-mock — no real AWS or LocalStack needed.
 */

import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { vi, describe, it, expect, beforeEach } from "vitest";

// ── Mock the DDB client BEFORE importing the handler ─────────────────────────
const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

// Mock getSignedUrl to return a fake URL
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.amazonaws.com/fake-export-url"),
}));

// Import AFTER mocking so the module-level client is intercepted
import { rawHandler as handler } from "../../src/lambdas/expenses/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    routeKey: "GET /expenses",
    body: null,
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: {
            sub: "user-abc",
            email: "test@example.com",
            "cognito:groups": "",
          },
        },
      },
    },
    ...overrides,
  };
}

const SAMPLE_EXPENSE = {
  pk: "USER#user-abc",
  sk: "EXPENSE#01HZ",
  expenseId: "01HZ",
  ownerId: "user-abc",
  merchant: "Starbucks",
  amount: 12.5,
  currency: "USD",
  amountUSD: 12.5,
  category: "Meals",
  date: "2026-02-01",
  status: "submitted",
  entityContext: "PERSONAL",
  tags: [],
  entityType: "EXPENSE",
  createdAt: "2026-02-01T12:00:00.000Z",
  updatedAt: "2026-02-01T12:00:00.000Z",
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
});

// ── GET /expenses ──────────────────────────────────────────────────────────────
describe("GET /expenses (list)", () => {
  it("returns paginated list of expenses", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [SAMPLE_EXPENSE],
      Count: 1,
      LastEvaluatedKey: undefined,
    });

    const res = await handler(makeEvent({ routeKey: "GET /expenses" }) as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].merchant).toBe("Starbucks");
    expect(body.nextToken).toBeNull();
  });

  it("applies status filter when provided", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { status: "pending" },
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      ExpressionAttributeValues: expect.objectContaining({
        ":status": "pending",
      }),
    });
  });

  it("applies category filter when provided", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { category: "Travel" },
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      ExpressionAttributeValues: expect.objectContaining({
        ":category": "Travel",
      }),
    });
  });

  it("decodes nextToken for pagination", async () => {
    const lastKey = { pk: "USER#user-abc", sk: "EXPENSE#01AA" };
    const nextToken = Buffer.from(JSON.stringify(lastKey)).toString("base64");

    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { nextToken },
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      ExclusiveStartKey: lastKey,
    });
  });

  it("returns nextToken when more results exist", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [SAMPLE_EXPENSE],
      Count: 1,
      LastEvaluatedKey: { pk: "USER#user-abc", sk: "EXPENSE#01HZ" },
    });

    const res = await handler(makeEvent({ routeKey: "GET /expenses" }) as any);
    const body = JSON.parse(res.body);
    expect(body.nextToken).toBeTruthy();
  });

  it("passes limit=200 (max allowed by Zod schema)", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { limit: "200" },
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      Limit: 200,
    });
  });

  it("rejects limit > 200 via Zod validation", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { limit: "9999" },
      }) as any
    );

    expect(res.statusCode).toBe(400);
  });
});

// ── GET /expenses/:id ──────────────────────────────────────────────────────────
describe("GET /expenses/{id}", () => {
  it("returns a single expense by id", async () => {
    ddbMock.on(GetCommand).resolves({ Item: SAMPLE_EXPENSE });

    const res = await handler(
      makeEvent({
        routeKey: "GET /expenses/{id}",
        pathParameters: { id: "01HZ" },
      }) as any
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.expenseId).toBe("01HZ");
  });

  it("returns 404 when expense does not exist", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    ddbMock.on(ScanCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({
        routeKey: "GET /expenses/{id}",
        pathParameters: { id: "nonexistent" },
      }) as any
    );

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Expense not found");
  });
});

// ── POST /expenses ─────────────────────────────────────────────────────────────
describe("POST /expenses", () => {
  const validPayload = {
    merchant: "Nobu Restaurant",
    amount: 287.5,
    currency: "USD",
    date: "2026-02-20",
    category: "Meals",
  };

  it("creates a new expense and returns 201", async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify(validPayload),
      }) as any
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.merchant).toBe("Nobu Restaurant");
    expect(body.amount).toBe(287.5);
    expect(body.status).toBe("submitted");
    expect(body.expenseId).toBeDefined();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ merchant: "Starbucks" }), // missing amount, currency, date
      }) as any
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/[Rr]equired/);
  });

  it("returns 400 for zero or negative amount", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ ...validPayload, amount: -5 }),
      }) as any
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/[Aa]mount/);
  });

  it("returns 400 for amount exceeding 1,000,000", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ ...validPayload, amount: 1_500_000 }),
      }) as any
    );

    expect(res.statusCode).toBe(400);
  });

  it("defaults category to 'Other' when not provided", async () => {
    ddbMock.on(PutCommand).resolves({});
    const { category: _c, ...noCategory } = validPayload;

    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify(noCategory),
      }) as any
    );

    const body = JSON.parse(res.body);
    expect(body.category).toBe("Other");
  });

  it("trims merchant name whitespace", async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ ...validPayload, merchant: "  Padded Name  " }),
      }) as any
    );

    expect(JSON.parse(res.body).merchant).toBe("Padded Name");
  });

  it("returns 409 when ConditionalCheckFailedException is thrown", async () => {
    const err = new Error("ConditionalCheckFailedException");
    err.name = "ConditionalCheckFailedException";
    ddbMock.on(PutCommand).rejects(err);

    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify(validPayload),
      }) as any
    );

    expect(res.statusCode).toBe(409);
  });
});

// ── PATCH /expenses/:id ────────────────────────────────────────────────────────
describe("PATCH /expenses/{id}", () => {
  beforeEach(() => {
    // The refined handler now performs a lookup before patching
    ddbMock.on(QueryCommand).resolves({ Items: [SAMPLE_EXPENSE] });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...SAMPLE_EXPENSE, merchant: "Updated Corp" },
    });
  });

  it("updates allowed fields", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "PATCH /expenses/{id}",
        pathParameters: { id: "01HZ" },
        body: JSON.stringify({ merchant: "Updated Corp" }),
      }) as any
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).merchant).toBe("Updated Corp");
  });

  it("sets approvedAt when status is approved", async () => {
    await handler(
      makeEvent({
        routeKey: "PATCH /expenses/{id}",
        pathParameters: { id: "01HZ" },
        body: JSON.stringify({ status: "approved" }),
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      ExpressionAttributeValues: expect.objectContaining({
        ":approvedAt": expect.any(String),
        ":approverId": "user-abc",
      }),
    });
  });

  it("returns 409 on ConditionalCheckFailedException (expense not found)", async () => {
    const err = new Error();
    err.name = "ConditionalCheckFailedException";
    ddbMock.on(UpdateCommand).rejects(err);

    const res = await handler(
      makeEvent({
        routeKey: "PATCH /expenses/{id}",
        pathParameters: { id: "nonexistent" },
        body: JSON.stringify({ merchant: "x" }),
      }) as any
    );

    expect(res.statusCode).toBe(409);
  });
});

// ── DELETE /expenses/:id ───────────────────────────────────────────────────────
describe("DELETE /expenses/{id}", () => {
  it("deletes the expense and returns { deleted: true }", async () => {
    ddbMock.on(DeleteCommand).resolves({});

    const res = await handler(
      makeEvent({
        routeKey: "DELETE /expenses/{id}",
        pathParameters: { id: "01HZ" },
      }) as any
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: true });
    expect(ddbMock).toHaveReceivedCommandWith(DeleteCommand, {
      Key: { pk: "USER#user-abc", sk: "EXPENSE#01HZ" },
      ConditionExpression: "ownerId = :uid",
    });
  });
});

// ── GET /expenses/export ──────────────────────────────────────────────────────
describe("GET /expenses/export", () => {
  const makeExportEvent = (qs: Record<string, string> = {}) =>
    makeEvent({ routeKey: "GET /expenses/export", queryStringParameters: qs }) as any;

  const SAMPLE_EXPORT_ITEM = {
    ...SAMPLE_EXPENSE,
    expenseId: "01HZ",
    merchant: "Starbucks",
    amount: 12.5,
    currency: "USD",
    category: "Meals",
    date: "2026-02-01",
    status: "submitted",
    approvalRequired: true,
    approvedBy: null,
    notes: "Team lunch",
    tags: ["work"],
    groupId: null,
    splitMethod: null,
    splitDetails: null,
  };

  it("returns empty CSV for empty result set", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    const res = await handler(makeExportEvent());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/csv");
    // Only header row
    expect(res.body).toContain("expenseId,merchant,amount");
    expect(res.body).not.toContain("Starbucks");
  });

  it("returns CSV with correct columns for matching expenses", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [SAMPLE_EXPORT_ITEM],
      Count: 1,
    });

    const res = await handler(makeExportEvent());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/csv");
    expect(res.headers["Content-Disposition"]).toContain("expenses-");
    expect(res.headers["Content-Disposition"]).toContain(".csv");
    expect(res.body).toContain("Starbucks");
    expect(res.body).toContain("12.5");
    expect(res.body).toContain("Meals");
  });

  it("returns JSON when format=json", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [SAMPLE_EXPORT_ITEM],
      Count: 1,
    });

    const res = await handler(makeExportEvent({ format: "json" }));

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["Content-Disposition"]).toContain(".json");
    const parsed = JSON.parse(res.body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].merchant).toBe("Starbucks");
  });

  it("validates format parameter — rejects invalid format", async () => {
    const res = await handler(makeExportEvent({ format: "xml" }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("csv");
  });

  it("rejects limit over 10000", async () => {
    const res = await handler(makeExportEvent({ limit: "10001" }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("10000");
  });

  it("filters by date range (from/to)", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [SAMPLE_EXPORT_ITEM], Count: 1 });

    await handler(makeExportEvent({ from: "2026-01-01", to: "2026-02-28" }));

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      FilterExpression: expect.stringContaining("#date"),
    });
  });

  it("switches to GROUP# partition when groupId is provided", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });

    await handler(makeExportEvent({ groupId: "01GROUP" }));

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      ExpressionAttributeValues: expect.objectContaining({
        ":pk": "GROUP#01GROUP",
      }),
    });
  });

  it("writes to S3 and returns presigned URL when items exceed threshold", async () => {
    // Create 1001 items to exceed S3_EXPORT_THRESHOLD (1000)
    const manyItems = Array.from({ length: 1001 }, (_, i) => ({
      ...SAMPLE_EXPORT_ITEM,
      sk: `EXPENSE#item-${i}`,
      expenseId: `item-${i}`,
    }));
    ddbMock.on(QueryCommand)
      .resolvesOnce({ Items: manyItems.slice(0, 1000), Count: 1000, LastEvaluatedKey: { pk: "x", sk: "y" } })
      .resolvesOnce({ Items: manyItems.slice(1000), Count: 1 });

    const res = await handler(makeExportEvent());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(res.body);
    expect(body.downloadUrl).toBe("https://s3.amazonaws.com/fake-export-url");
    expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
      ContentType: "text/csv",
    });
  });

  it("strips internal fields (pk, sk, gsi1pk, etc.) from CSV output", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ ...SAMPLE_EXPENSE, pk: "USER#x", sk: "EXPENSE#y", gsi1pk: "STATUS#draft", gsi1sk: "DATE#..." }],
      Count: 1,
    });

    const res = await handler(makeExportEvent());

    expect(res.body).not.toContain("USER#x");
    expect(res.body).not.toContain("gsi1pk");
    expect(res.body).toContain("Starbucks");
  });

  it("ignores unknown query params due to middleware sanitization", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [], Count: 0 });
    const res = await handler(makeExportEvent({ unknownParam: "bad" }));

    expect(res.statusCode).toBe(200);
    expect(ddbMock).toHaveReceivedCommand(QueryCommand);
  });
});

// ── Unknown route ──────────────────────────────────────────────────────────────
describe("Unknown routes", () => {
  it("returns 404 for unrecognised routeKey", async () => {
    const res = await handler(
      makeEvent({ routeKey: "PUT /nonsense" }) as any
    );
    expect(res.statusCode).toBe(404);
  });
});
