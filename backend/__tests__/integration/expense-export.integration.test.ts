/**
 * expense-export.integration.test.ts
 * Integration tests for the expense-export Lambda via LocalStack.
 * Requires: docker compose -f docker-compose.localstack.yml up -d
 */

import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddbDoc, TABLE_NAME_MAIN, TEST_USER_ID, makeApiEvent, cleanTable } from "../__helpers__/localstack-client.js";

import { rawHandler as handler } from "../../src/lambdas/expense-export/index.js";

const UID = TEST_USER_ID;

beforeEach(async () => {
  await cleanTable(`USER#${UID}`);
});

afterAll(async () => {
  await cleanTable(`USER#${UID}`);
});

// Seed helper
async function seedExpenses(items: any[]) {
  for (const item of items) {
    await ddbDoc.send(new PutCommand({ TableName: TABLE_NAME_MAIN, Item: item }));
  }
}

describe("GET /expense-export — integration via LocalStack", () => {
  describe("inline CSV (small datasets)", () => {
    beforeEach(async () => {
      await seedExpenses([
        { pk: `USER#${UID}`, sk: "EXPENSE#E1", expenseId: "E1", ownerId: UID, merchant: "Starbucks", amount: 12, currency: "USD", category: "Meals", date: "2026-03-01", status: "approved", entityType: "EXPENSE", createdAt: new Date().toISOString() },
        { pk: `USER#${UID}`, sk: "EXPENSE#E2", expenseId: "E2", ownerId: UID, merchant: "Delta", amount: 450, currency: "USD", category: "Travel", date: "2026-03-02", status: "pending", entityType: "EXPENSE", createdAt: new Date().toISOString() },
      ]);
    });

    it("exports all expenses as inline CSV", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.format).toBe("csv");
      expect(body.count).toBe(2);
      expect(body.data).toContain("Starbucks");
      expect(body.data).toContain("Delta");
    });

    it("filters by status=approved", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", queryStringParameters: { status: "approved" }, userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(1);
      expect(body.data).toContain("Starbucks");
    });

    it("filters by category=Travel", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", queryStringParameters: { category: "Travel" }, userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(1);
      expect(body.data).toContain("Delta");
    });

    it("filters by date range", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", queryStringParameters: { from: "2026-02-01", to: "2026-03-01" }, userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(1);
      expect(body.data).toContain("Starbucks");
    });
  });

  describe("JSON format", () => {
    beforeEach(async () => {
      await seedExpenses([
        { pk: `USER#${UID}`, sk: "EXPENSE#J1", expenseId: "J1", ownerId: UID, merchant: "Amazon", amount: 99, currency: "USD", category: "Software", date: "2026-03-03", status: "approved", entityType: "EXPENSE", createdAt: new Date().toISOString() },
      ]);
    });

    it("exports as JSON when format=json", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", queryStringParameters: { format: "json" }, userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.format).toBe("json");
      const parsed = JSON.parse(body.data);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].merchant).toBe("Amazon");
    });
  });

  describe("group-scoped export", () => {
    const GROUP_ID = "int-test-group";

    beforeEach(async () => {
      // Seed a group-scoped expense
      await seedExpenses([
        { pk: `GROUP#${GROUP_ID}`, sk: "EXPENSE#G1", expenseId: "G1", ownerId: UID, merchant: "Group Lunch", amount: 50, currency: "USD", category: "Meals", date: "2026-03-04", status: "approved", entityType: "EXPENSE", createdAt: new Date().toISOString() },
      ]);
    });

    it("exports expenses for a specific group", async () => {
      const res = await handler(makeApiEvent({ routeKey: "GET /expense-export", queryStringParameters: { groupId: GROUP_ID }, userId: UID }) as any);
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.count).toBe(1);
      expect(body.data).toContain("Group Lunch");
    });
  });
});
