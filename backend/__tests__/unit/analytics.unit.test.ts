/**
 * analytics.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/analytics/index.ts
 */


import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbMock = mockClient(DynamoDBDocumentClient);

import { handler } from "../../src/lambdas/analytics/index.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    routeKey: "GET /analytics/summary",
    body: null,
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: "user-abc", email: "test@example.com" } },
      },
    },
    ...overrides,
  };
}

function makeExpense(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    pk: "USER#user-abc",
    sk: "EXPENSE#01HZ",
    expenseId: "01HZ",
    merchant: "Starbucks",
    amount: 12.5,
    amountUSD: 12.5,
    currency: "USD",
    category: "Meals",
    date: new Date().toISOString().slice(0, 10), // today
    status: "approved",
    ...overrides,
  };
}

beforeEach(() => ddbMock.reset());

// ── Summary ────────────────────────────────────────────────────────────────────
describe("GET /analytics/summary", () => {
  it("returns aggregated summary for the current month", async () => {
    const expenses = [
      makeExpense({ amount: 100, amountUSD: 100, category: "Travel" }),
      makeExpense({ amount: 50,  amountUSD: 50,  category: "Meals" }),
      makeExpense({ amount: 25,  amountUSD: 25,  category: "Meals" }),
    ];
    ddbMock.on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/summary" }) as any
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalAmount).toBeCloseTo(175);
    expect(body.expenseCount).toBe(3);
    expect(body.averageExpense).toBeCloseTo(175 / 3);
  });

  // it("sorts byCategory descending by amount", async () => {
  //   const expenses = [
  //     makeExpense({ amount: 10,  category: "Meals" }),
  //     makeExpense({ amount: 500, category: "Travel" }),
  //     makeExpense({ amount: 50,  category: "Software" }),
  //   ];
  //   ddbMock.on(QueryCommand).resolves({ Items: expenses });

  //   const res = await handler(
  //     makeEvent({ routeKey: "GET /analytics/summary" }) as any
  //   );
  //   const body = JSON.parse(res.body);

  //   expect(body.byCategory[0].category).toBe("Travel");
  //   expect(body.byCategory[1].category).toBe("Software");
  //   expect(body.byCategory[2].category).toBe("Meals");
  // });

  it("caps byCategory to top 8 categories", async () => {
    const categories = ["A","B","C","D","E","F","G","H","I","J"]; // 10
    const expenses = categories.map((cat) =>
      makeExpense({ category: cat, amount: 10 })
    );
    ddbMock.on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/summary" }) as any
    );
    const body = JSON.parse(res.body);

    expect(body.byCategory.length).toBeLessThanOrEqual(8);
  });

  it("returns 0 averageExpense when no expenses", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/summary" }) as any
    );
    const body = JSON.parse(res.body);

    expect(body.totalAmount).toBe(0);
    expect(body.averageExpense).toBe(0);
    expect(body.expenseCount).toBe(0);
  });

  it("accepts period=quarter and constructs correct startDate", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(
      makeEvent({
        routeKey: "GET /analytics/summary",
        queryStringParameters: { period: "quarter" },
      }) as any
    );

    const call = ddbMock.commandCalls(QueryCommand)[0];
    const startDate =
      call.args[0].input.ExpressionAttributeValues?.[":startDate"] as string;
    // Quarter start should be the 1st of a month
    expect(startDate).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it("accepts period=year and sets startDate to Jan 1", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(
      makeEvent({
        routeKey: "GET /analytics/summary",
        queryStringParameters: { period: "year" },
      }) as any
    );

    const call = ddbMock.commandCalls(QueryCommand)[0];
    const startDate =
      call.args[0].input.ExpressionAttributeValues?.[":startDate"] as string;
    expect(startDate).toMatch(/\d{4}-01-01/);
  });

  it("uses amountUSD when available (multi-currency)", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        makeExpense({ amount: 100, amountUSD: 92, currency: "EUR" }),
      ],
    });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/summary" }) as any
    );
    const body = JSON.parse(res.body);
    // Should use amountUSD (92), not amount (100)
    expect(body.totalAmount).toBeCloseTo(92);
  });
});

// ── Trends ─────────────────────────────────────────────────────────────────────
describe("GET /analytics/trends", () => {
  it("returns 6 months of trend data", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/trends" }) as any
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.trend).toHaveLength(6);
  });

  it("trend months are in ascending chronological order", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/trends" }) as any
    );
    const { trend } = JSON.parse(res.body);

    for (let i = 1; i < trend.length; i++) {
      expect(trend[i].label >= trend[i - 1].label).toBe(true);
    }
  });

  it("aggregates expense amounts into the correct month bucket", async () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const expense = makeExpense({ date: `${thisMonth}-15`, amountUSD: 200, amount: 200 });

    ddbMock.on(QueryCommand).resolves({ Items: [expense] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/trends" }) as any
    );
    const { trend } = JSON.parse(res.body);
    const thisBucket = trend.find((t: any) => t.label === thisMonth);

    expect(thisBucket?.total).toBeCloseTo(200);
    expect(thisBucket?.count).toBe(1);
  });

  it("returns zeros for months with no expenses", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/trends" }) as any
    );
    const { trend } = JSON.parse(res.body);

    for (const bucket of trend) {
      expect(bucket.total).toBe(0);
      expect(bucket.count).toBe(0);
    }
  });
});

// ── Chart Data ───────────────────────────────────────────────────────────────
describe("GET /analytics/chart-data", () => {
  it("returns donut and bubble chart data", async () => {
    const expenses = [
      makeExpense({ amount: 100, category: "Food" }),
      makeExpense({ amount: 50, category: "Travel" }),
    ];
    ddbMock.on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/chart-data" }) as any
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.donut).toHaveLength(2);
    expect(body.bubble).toHaveLength(2);
  });

  it("donut data contains label and value", async () => {
    const expenses = [
      makeExpense({ amount: 100, amountUSD: 100, category: "Food" }),
      makeExpense({ amount: 50, amountUSD: 50, category: "Travel" }),
    ];
    ddbMock.on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/chart-data" }) as any
    );
    const { donut } = JSON.parse(res.body);

    expect(donut).toContainEqual(expect.objectContaining({ label: "Food", value: 100 }));
    expect(donut).toContainEqual(expect.objectContaining({ label: "Travel", value: 50 }));
  });

  it("returns empty arrays when no expenses", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/chart-data" }) as any
    );
    const body = JSON.parse(res.body);

    expect(body.donut).toEqual([]);
    expect(body.bubble).toEqual([]);
  });
});

// ── 404 ────────────────────────────────────────────────────────────────────────
describe("Unknown route", () => {
  it("returns 404", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const res = await handler(
      makeEvent({ routeKey: "GET /analytics/unknown" }) as any
    );
    expect(res.statusCode).toBe(404);
  });
});