import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { describe, it, expect, beforeEach } from "vitest";

const ddbMock = mockClient(DynamoDBDocumentClient);

import { rawHandler as handler } from "../../src/lambdas/groups/index.js";

function makeEvent(overrides: Record<string, unknown> = {}) {
  const routeKey = (overrides.routeKey as string) || "GET /groups";
  let path = (overrides.path as string) || routeKey.split(" ")[1] || "/groups";
  
  if (overrides.pathParameters && (overrides.pathParameters as any).id) {
    path = path.replace("{id}", (overrides.pathParameters as any).id);
  }

  return {
    version: "2.0",
    routeKey,
    path,
    body: null,
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { sub: "user-owner", email: "owner@test.com" },
        },
      },
      http: {
        method: routeKey.split(" ")[0],
        path: path,
      }
    },
    ...overrides,
  };
}

const SAMPLE_GROUP = {
  pk: "GROUP#g1",
  sk: "PROFILE#g1",
  groupId: "g1",
  name: "Road Trip",
  ownerId: "user-owner",
  entityType: "GROUP",
  members: [
    { userId: "user-owner", name: "Owner", email: "owner@test.com", role: "owner" },
    { userId: "user-a", name: "Alice", email: "a@test.com", role: "member" },
  ],
  currency: "USD",
  active: true,
};

describe("Groups API Unit Tests", () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  describe("GET /groups/{id}/balances", () => {
    it("calculates balances and returns settlements", async () => {
      const expenses = [
        {
          pk: "GROUP#g1", sk: "EXPENSE#e1",
          ownerId: "user-owner", amount: 100, status: "approved",
          splits: [
            { userId: "user-owner", amount: 50 },
            { userId: "user-a", amount: 50 },
          ],
        },
      ];

      ddbMock
        .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
        .on(QueryCommand).resolves({ Items: expenses });

      const res = await handler(makeEvent({
        routeKey: "GET /groups/{id}/balances",
        pathParameters: { id: "g1" }
      }) as any);
      
      const body = JSON.parse(res.body);
      expect(res.statusCode).toBe(200);
      expect(body.balances).toBeDefined();
      expect(body.balances["user-owner"]).toBe(50);
      expect(body.balances["user-a"]).toBe(-50);
      expect(body.settlements[0]).toMatchObject({ from: "user-a", to: "user-owner", amount: 50 });
    });
  });

  describe("POST /groups/{id}/settle", () => {
    it("marks approved expenses as reimbursed", async () => {
      ddbMock
        .on(QueryCommand).resolves({ 
          Items: [{ pk: "GROUP#g1", sk: "EXPENSE#e1", status: "approved" }] 
        })
        .on(UpdateCommand).resolves({});

      const res = await handler(makeEvent({
        routeKey: "POST /groups/{id}/settle",
        pathParameters: { id: "g1" }
      }) as any);

      expect(res.statusCode).toBe(200);
      expect(ddbMock).toHaveReceivedCommand(UpdateCommand);
      const update = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
      expect(update.ExpressionAttributeValues[":s"]).toBe("reimbursed");
    });

    it("returns 400 if no approved expenses", async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      const res = await handler(makeEvent({
        routeKey: "POST /groups/{id}/settle",
        pathParameters: { id: "g1" }
      }) as any);
      expect(res.statusCode).toBe(400);
    });
  });
});
