import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/lambdas/analytics/index.js";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeEvent(path: string, query: any = {}) {
  return {
    path,
    queryStringParameters: query,
    requestContext: {
      authorizer: { jwt: { claims: { sub: "test-user-001" } } }
    }
  } as any;
}

describe("Analytics Edge Cases & Validation", () => {
  beforeEach(() => {
    ddbMock.reset();
    ddbMock.on(QueryCommand).resolves({ Items: [] });
  });

  // 1. Route Identification
  it("identifies /chart-data route correctly in LocalStack-style paths", async () => {
    const localStackPath = "/restapis/8452qb3zcb/local/_user_request_/analytics/chart-data";
    const res = await handler(makeEvent(localStackPath, { period: "month" }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("donut");
  });

  // 2. Date Validation (Inverted & Future)
  it("returns 400 for inverted date range (startDate > endDate)", async () => {
    const res = await handler(makeEvent("/analytics/summary", { 
      from: "2026-03-20", // In the past relative to 03-27
      to: "2026-03-10" 
    }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid date range/);
  });

  it("returns 400 for future dates", async () => {
    // Current date in test env is 2026-03-27
    const res = await handler(makeEvent("/analytics/summary", { from: "2030-01-01" }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Date cannot be in the future/);
  });

  // 3. Malformed Parameters
  it("returns 400 for malformed date strings", async () => {
    const res = await handler(makeEvent("/analytics/summary", { from: "not-a-date" }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Date must be YYYY-MM-DD/);
  });

  it("returns 400 for invalid period enum", async () => {
    const res = await handler(makeEvent("/analytics/summary", { period: "century" }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid scope enum", async () => {
    const res = await handler(makeEvent("/analytics/summary", { scope: "admin" }));
    expect(res.statusCode).toBe(400);
  });

  // 4. Empty/Missing Parameters (Graceful defaults)
  it("handles empty categories string gracefully", async () => {
    const res = await handler(makeEvent("/analytics/summary", { categories: "" }));
    expect(res.statusCode).toBe(200);
    expect(ddbMock).toHaveReceivedCommand(QueryCommand);
  });

  it("works with no query parameters (defaults to month)", async () => {
    const res = await handler(makeEvent("/analytics/summary", {}));
    expect(res.statusCode).toBe(200);
  });

  // 5. Valid Combinations (Aliases from/to vs startDate/endDate)
  it("accepts 'from' and 'to' as aliases for startDate/endDate", async () => {
    const res = await handler(makeEvent("/analytics/summary", { from: "2026-01-01", to: "2026-03-20" }));
    expect(res.statusCode).toBe(200);
  });

  it("correctly filters by multi-category string", async () => {
    // Use a simpler mock pattern to ensure items are returned
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { category: "Office", amount: 10, date: "2026-03-01" },
        { category: "Meals", amount: 20, date: "2026-03-01" },
        { category: "Travel", amount: 30, date: "2026-03-01" }
      ]
    });

    // We only need the first call to return items for this test (personal scope or simplified mock)
    const res = await handler(makeEvent("/analytics/summary", { 
      scope: "personal", 
      categories: "Office,Travel" 
    }));
    
    const body = JSON.parse(res.body);
    expect(body.expenseCount).toBe(2);
  });
});
