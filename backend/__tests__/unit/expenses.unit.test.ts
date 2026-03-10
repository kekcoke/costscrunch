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
} from "@aws-sdk/lib-dynamodb";

// ── Mock the DDB client BEFORE importing the handler ─────────────────────────
const ddbMock = mockClient(DynamoDBDocumentClient);

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
    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      TableName: "test-table",
      KeyConditionExpression: expect.stringContaining("pk"),
    });
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
      FilterExpression: expect.stringContaining("status"),
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

  it("caps limit at 200", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(
      makeEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { limit: "9999" },
      }) as any
    );

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      Limit: 200,
    });
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
    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      TableName: "test-table",
      ConditionExpression: "attribute_not_exists(pk)",
    });
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ merchant: "Starbucks" }), // missing amount, currency, date
      }) as any
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/required/);
    expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
  });

  it("returns 400 for zero or negative amount", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /expenses",
        body: JSON.stringify({ ...validPayload, amount: -5 }),
      }) as any
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/amount/);
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
  it("updates allowed fields", async () => {
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...SAMPLE_EXPENSE, merchant: "Updated Corp" },
    });

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
    ddbMock.on(UpdateCommand).resolves({ Attributes: SAMPLE_EXPENSE });

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
      ConditionExpression: expect.stringContaining("ownerId"),
    });
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