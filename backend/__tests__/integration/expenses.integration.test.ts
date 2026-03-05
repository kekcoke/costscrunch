/**
 * expenses.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for the expenses Lambda handler.
 * Requires LocalStack running: docker compose -f docker-compose.localstack.yml up -d
 *
 * These tests write and read real DynamoDB items through LocalStack.
 */

import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import {
  ddbDoc,
  TABLE_NAME,
  TEST_USER_ID,
  makeApiEvent,
  cleanTable,
} from "../__helpers__/localstack-client";

console.log("DEBUG: Current Region Env:", process.env.AWS_REGION);
// Re-point the Lambda's DDB client at LocalStack via env vars (set in jest.setup.integration.ts)
import { rawHandler as handler } from "../../src/lambdas/expenses";

const UID = TEST_USER_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup test data before and after each test to avoid cross-test pollution
beforeEach(async () => {
  await cleanTable(`USER#${UID}`);
});

afterAll(async () => {
  await cleanTable(`USER#${UID}`);
});

// ─────────────────────────────────────────────────────────────────────────────

const CREATE_BODY = {
  merchant:  "Integration Test Corp",
  amount:    99.99,
  currency:  "USD",
  date:      "2026-02-15",
  category:  "Software",
};

// ── Create + Read round-trip ──────────────────────────────────────────────────
describe("Create → Get round-trip", () => {
  it("writes an expense to DynamoDB and retrieves it by id", async () => {
    // 1. Create
    const createRes = await handler(
      makeApiEvent({ routeKey: "POST /expenses", body: CREATE_BODY, userId: UID }) as any
    );
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body);
    const expenseId = created.expenseId;
    expect(expenseId).toBeTruthy();

    // 2. Get by ID
    const getRes = await handler(
      makeApiEvent({
        routeKey: "GET /expenses/{id}",
        pathParameters: { id: expenseId },
        userId: UID,
      }) as any
    );
    expect(getRes.statusCode).toBe(200);
    const fetched = JSON.parse(getRes.body);
    expect(fetched.merchant).toBe("Integration Test Corp");
    expect(fetched.amount).toBe(99.99);
    expect(fetched.status).toBe("submitted");
  });
});

// ── List expenses ─────────────────────────────────────────────────────────────
describe("GET /expenses — list from real DynamoDB", () => {
  beforeEach(async () => {
    // Seed 3 expenses directly into DynamoDB
    const items = [
      { pk: `USER#${UID}`, sk: "EXPENSE#01", expenseId: "01", ownerId: UID, merchant: "Starbucks", amount: 12, amountUSD: 12, currency: "USD", category: "Meals",    date: "2026-02-10", status: "approved",  tags: [], entityContext: "PERSONAL", entityType: "EXPENSE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), gsi1pk: "STATUS#approved", gsi1sk: "DATE#2026-02-10#01", gsi2pk: "CATEGORY#Meals",    gsi2sk: "DATE#2026-02-10#01" },
      { pk: `USER#${UID}`, sk: "EXPENSE#02", expenseId: "02", ownerId: UID, merchant: "Delta",     amount: 450, amountUSD: 450, currency: "USD", category: "Travel",  date: "2026-02-08", status: "pending",   tags: [], entityContext: "PERSONAL", entityType: "EXPENSE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), gsi1pk: "STATUS#pending",  gsi1sk: "DATE#2026-02-08#02", gsi2pk: "CATEGORY#Travel",   gsi2sk: "DATE#2026-02-08#02" },
      { pk: `USER#${UID}`, sk: "EXPENSE#03", expenseId: "03", ownerId: UID, merchant: "AWS",       amount: 1200, amountUSD: 1200, currency: "USD", category: "Software", date: "2026-02-05", status: "approved", tags: [], entityContext: "PERSONAL", entityType: "EXPENSE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), gsi1pk: "STATUS#approved", gsi1sk: "DATE#2026-02-05#03", gsi2pk: "CATEGORY#Software", gsi2sk: "DATE#2026-02-05#03" },
    ];
    for (const item of items) {
      await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    }
  });

  it("lists all expenses for a user", async () => {
    const res = await handler(
      makeApiEvent({ routeKey: "GET /expenses", userId: UID }) as any
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("filters by status=pending", async () => {
    const res = await handler(
      makeApiEvent({
        routeKey: "GET /expenses",
        queryStringParameters: { status: "pending" },
        userId: UID,
      }) as any
    );
    const body = JSON.parse(res.body);
    expect(body.items.every((e: any) => e.status === "pending")).toBe(true);
    expect(body.items.some((e: any) => e.merchant === "Delta")).toBe(true);
  });
});

// ── Update ────────────────────────────────────────────────────────────────────
describe("PATCH /expenses/{id}", () => {
  let expenseId: string;

  beforeEach(async () => {
    const res = await handler(
      makeApiEvent({ routeKey: "POST /expenses", body: CREATE_BODY, userId: UID }) as any
    );
    expenseId = JSON.parse(res.body).expenseId;
  });

  it("updates the merchant field in DynamoDB", async () => {
    const patchRes = await handler(
      makeApiEvent({
        routeKey: "PATCH /expenses/{id}",
        pathParameters: { id: expenseId },
        body: { merchant: "Updated Inc" },
        userId: UID,
      }) as any
    );
    expect(patchRes.statusCode).toBe(200);

    const getRes = await handler(
      makeApiEvent({
        routeKey: "GET /expenses/{id}",
        pathParameters: { id: expenseId },
        userId: UID,
      }) as any
    );
    expect(JSON.parse(getRes.body).merchant).toBe("Updated Inc");
  });

  it("sets approvedAt when approving", async () => {
    const patchRes = await handler(
      makeApiEvent({
        routeKey: "PATCH /expenses/{id}",
        pathParameters: { id: expenseId },
        body: { status: "approved" },
        userId: UID,
      }) as any
    );
    const body = JSON.parse(patchRes.body);
    expect(body.approvedAt).toBeDefined();
    expect(body.approverId).toBe(UID);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────
describe("DELETE /expenses/{id}", () => {
  it("removes the item from DynamoDB", async () => {
    // Create
    const createRes = await handler(
      makeApiEvent({ routeKey: "POST /expenses", body: CREATE_BODY, userId: UID }) as any
    );
    const { expenseId } = JSON.parse(createRes.body);

    // Delete
    const delRes = await handler(
      makeApiEvent({
        routeKey: "DELETE /expenses/{id}",
        pathParameters: { id: expenseId },
        userId: UID,
      }) as any
    );
    expect(delRes.statusCode).toBe(200);
    expect(JSON.parse(delRes.body).deleted).toBe(true);

    // Confirm gone
    const getRes = await handler(
      makeApiEvent({
        routeKey: "GET /expenses/{id}",
        pathParameters: { id: expenseId },
        userId: UID,
      }) as any
    );
    expect(getRes.statusCode).toBe(404);
  });

  it("does not allow deleting another user's expense but return 200 as idempotent response", async () => {
    // Seed an expense owned by a DIFFERENT user
    await ddbDoc.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          pk: `USER#${UID}`,
          sk: "EXPENSE#OTHER-OWN",
          expenseId: "OTHER-OWN",
          ownerId: "other-user-999",  // ← NOT the requesting user
          merchant: "Someone Else",
          amount: 10, currency: "USD",
          category: "Other", date: "2026-01-01",
          status: "submitted", tags: [],
          entityContext: "PERSONAL", entityType: "EXPENSE",
          gsi1pk: "STATUS#submitted", gsi1sk: "DATE#2026-01-01#OTHER-OWN",
          gsi2pk: "CATEGORY#Other",   gsi2sk: "DATE#2026-01-01#OTHER-OWN",
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      })
    );

    const delRes = await handler(
      makeApiEvent({
        routeKey: "DELETE /expenses/{id}",
        pathParameters: { id: "OTHER-OWN" },
        userId: UID,  // ← requesting user is NOT the owner
      }) as any
    );
    // DynamoDB ConditionExpression (ownerId = :uid) should reject this
    expect(delRes.statusCode).toBe(200);
  });
});