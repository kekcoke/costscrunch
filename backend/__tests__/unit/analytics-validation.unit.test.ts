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
      from: "2026-03-20", 
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

  // 4. Empty/Missing Parameters (Graceful defaults)
  it("handles empty categories string gracefully", async () => {
    const res = await handler(makeEvent("/analytics/summary", { categories: "" }));
    expect(res.statusCode).toBe(200);
  });

  // 5. Valid Combinations & Aliases
  it("accepts 'from' and 'to' as aliases for startDate/endDate", async () => {
    const res = await handler(makeEvent("/analytics/summary", { from: "2026-01-01", to: "2026-03-20" }));
    expect(res.statusCode).toBe(200);
  });

  it("prioritizes 'from/to' aliases over 'startDate/endDate' for consistency", async () => {
    const res = await handler(makeEvent("/analytics/summary", { 
      from: "2026-03-10", 
      startDate: "2026-01-01",
      to: "2026-03-20",
      endDate: "2026-03-25" // Adjusted to past date
    }));
    expect(res.statusCode).toBe(200);
    
    // Check first call (personal scope)
    const lastCall = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(lastCall.ExpressionAttributeValues[":startDate"]).toBe("2026-03-10");
    expect(lastCall.ExpressionAttributeValues[":endDate"]).toBe("2026-03-20");
  });

  it("correctly implements data-layer filtering for multi-category string", async () => {
    await handler(makeEvent("/analytics/summary", { 
      scope: "personal", 
      categories: "Office,Travel" 
    }));
    
    const lastCall = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(lastCall.FilterExpression).toContain("category IN (:cat0, :cat1)");
    expect(lastCall.ExpressionAttributeValues[":cat0"]).toBe("Office");
    expect(lastCall.ExpressionAttributeValues[":cat1"]).toBe("Travel");
  });
});
