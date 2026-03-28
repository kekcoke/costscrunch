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
      authorizer: { jwt: { claims: { sub: "user-1" } } }
    }
  } as any;
}

describe("Analytics Edge Cases & Validation", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("returns 400 for inverted date range", async () => {
    const event = makeEvent("/analytics/summary", { 
      startDate: "2026-03-30", 
      endDate: "2026-03-01" 
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid date range/);
  });

  it("identifies /chart-data route correctly in LocalStack-style paths", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const localStackPath = "/restapis/8452qb3zcb/local/_user_request_/analytics/chart-data";
    const event = makeEvent(localStackPath, { period: "month" });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("donut");
  });

  it("handles empty category parameter gracefully", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    const event = makeEvent("/analytics/summary", { categories: "" });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
  });
});
