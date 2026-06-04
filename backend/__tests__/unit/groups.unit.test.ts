import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { describe, it, expect, beforeEach } from "vitest";

const ddbMock = mockClient(DynamoDBDocumentClient);

import { rawHandler as handler, handler as wrappedHandler } from "../../src/lambdas/groups/index.js";

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
        .on(TransactWriteCommand).resolves({});

      const res = await handler(makeEvent({
        routeKey: "POST /groups/{id}/settle",
        pathParameters: { id: "g1" }
      }) as any);

      expect(res.statusCode).toBe(200);
      expect(ddbMock).toHaveReceivedCommand(TransactWriteCommand);
      const tw = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input;
      const updateItem = tw.TransactItems![0].Update!;
      expect(updateItem.ExpressionAttributeValues![":s"]).toBe("reimbursed");
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

  // TEST-001 — Settlement atomicity (CON-002)
  describe("POST /groups/{id}/settle — atomicity", () => {
    it("returns 500 and makes exactly one TransactWrite attempt when the transaction fails", async () => {
      ddbMock
        .on(QueryCommand).resolves({
          Items: [{ pk: "GROUP#g1", sk: "EXPENSE#e1", status: "approved" }],
        })
        .on(TransactWriteCommand).rejects(
          Object.assign(new Error("TransactionCanceledException"), {
            name: "TransactionCanceledException",
            // No CancellationReasons → isRetryableError returns false → thrown on first attempt
          })
        );

      const res = await wrappedHandler(
        makeEvent({ routeKey: "POST /groups/{id}/settle", pathParameters: { id: "g1" } }) as any
      );

      expect(res.statusCode).toBe(500);
      // Only 1 attempt — no partial writes or spurious retries
      expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    });

    it("returns settled message when TransactWrite succeeds", async () => {
      ddbMock
        .on(QueryCommand).resolves({
          Items: [
            { pk: "GROUP#g1", sk: "EXPENSE#e1", status: "approved" },
            { pk: "GROUP#g1", sk: "EXPENSE#e2", status: "approved" },
          ],
        })
        .on(TransactWriteCommand).resolves({});

      const res = await wrappedHandler(
        makeEvent({ routeKey: "POST /groups/{id}/settle", pathParameters: { id: "g1" } }) as any
      );

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toMatch(/2/);
    });
  });

  // TEST-003 — Group join TOCTOU guard (CON-001)
  describe("POST /groups/{id}/join", () => {
    it("returns 409 when member already exists (concurrent join race)", async () => {
      ddbMock
        .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
        .on(TransactWriteCommand).rejects(
          Object.assign(new Error("TransactionCanceledException"), {
            name: "TransactionCanceledException",
            CancellationReasons: [
              { Code: "None" },                   // Update item: no conflict
              { Code: "ConditionalCheckFailed" },  // Put item: member row already exists
            ],
          })
        );

      const res = await handler(
        makeEvent({ routeKey: "POST /groups/{id}/join", pathParameters: { id: "g1" } }) as any
      );

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error).toMatch(/already a member/i);
    });

    it("adds member and returns 200 on successful join", async () => {
      ddbMock
        .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
        .on(TransactWriteCommand).resolves({});

      const res = await handler(
        makeEvent({ routeKey: "POST /groups/{id}/join", pathParameters: { id: "g1" } }) as any
      );

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.joined).toBe(true);
      expect(body.groupId).toBe("g1");
    });
  });
});
