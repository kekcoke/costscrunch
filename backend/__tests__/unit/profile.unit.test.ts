import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { handler } from "../../src/lambdas/profile/index.js";

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeEvent(method: string, body: any = null) {
  return {
    version: "2.0",
    routeKey: `${method} /profile`,
    httpMethod: method,
    body: body ? JSON.stringify(body) : null,
    requestContext: {
      http: { method, path: "/profile" },
      authorizer: {
        jwt: { claims: { sub: "user-123", email: "test@example.com" } },
      },
    },
  };
}

describe("Profile Lambda", () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env.TABLE_NAME_MAIN = "TestTable";
  });

  it("GET /profile returns user profile", async () => {
    const mockProfile = {
      pk: "USER#user-123",
      sk: "PROFILE#user-123",
      name: "Test User",
      email: "test@example.com",
      currency: "USD"
    };
    ddbMock.on(GetCommand).resolves({ Item: mockProfile });

    const res = await handler(makeEvent("GET") as any);
    
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(mockProfile);
  });

  it("PATCH /profile updates allowed fields", async () => {
    const updates = { name: "New Name", currency: "EUR" };
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...updates, updatedAt: "2026-03-27T00:00:00Z" }
    });

    const res = await handler(makeEvent("PATCH", updates) as any);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("New Name");
    expect(body.currency).toBe("EUR");

    const call = ddbMock.commandCalls(UpdateCommand)[0];
    expect(call.args[0].input.UpdateExpression).toContain("#name = :name");
    expect(call.args[0].input.ExpressionAttributeValues).toMatchObject({
      ":name": "New Name",
      ":currency": "EUR"
    });
  });

  it("PATCH /profile rejects invalid data", async () => {
    const res = await handler(makeEvent("PATCH", { currency: "INVALID" }) as any);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("String must contain exactly 3 character(s)");
  });
});
