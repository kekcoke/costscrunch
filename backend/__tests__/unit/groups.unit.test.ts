/**
 * groups.unit.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unit tests for backend/src/lambdas/groups/index.ts
 * Heavy focus on the calculateBalances / minimizeTransactions algorithm
 * because that's pure logic with no I/O.
 */

import { mockClient } from "aws-sdk-client-mock";
import "aws-sdk-client-mock-jest";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ddbMock = mockClient(DynamoDBDocumentClient);
const sesMock = mockClient(SESClient);

import { handler } from "../../src/lambdas/groups/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    version: "2.0",
    routeKey: "GET /groups",
    body: null,
    pathParameters: {},
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: {
          claims: { sub: "user-owner", email: "owner@test.com", "cognito:groups": "" },
        },
      },
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
  memberCount: 3,
  members: [
    { userId: "user-a", name: "Alice", email: "a@test.com", role: "owner", joinedAt: "2026-01-01T00:00:00Z", totalSpend: 0, balance: 0 },
    { userId: "user-b", name: "Bob",   email: "b@test.com", role: "member", joinedAt: "2026-01-01T00:00:00Z", totalSpend: 0, balance: 0 },
    { userId: "user-c", name: "Carol", email: "c@test.com", role: "member", joinedAt: "2026-01-01T00:00:00Z", totalSpend: 0, balance: 0 },
  ],
  currency: "USD",
  totalSpend: 0,
  monthSpend: 0,
  expenseCount: 0,
  active: true,
  budgets: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  ddbMock.reset();
  sesMock.reset();
});

// ── POST /groups ──────────────────────────────────────────────────────────────
describe("POST /groups", () => {
  it("creates a group and returns 201", async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      makeEvent({
        routeKey: "POST /groups",
        body: JSON.stringify({ name: "Team Expenses", type: "business" }),
      }) as any
    );

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe("Team Expenses");
    expect(body.ownerId).toBe("user-owner");
    expect(body.memberCount).toBe(1);
    expect(body.members[0].role).toBe("owner");
  });

  it("returns 400 when name is missing", async () => {
    const res = await handler(
      makeEvent({ routeKey: "POST /groups", body: JSON.stringify({}) }) as any
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/name/);
    expect(ddbMock).not.toHaveReceivedCommand(PutCommand);
  });

  it("applies defaults (currency USD, approvalRequired false)", async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handler(
      makeEvent({ routeKey: "POST /groups", body: JSON.stringify({ name: "Test" }) }) as any
    );

    const body = JSON.parse(res.body);
    expect(body.currency).toBe("USD");
    expect(body.approvalRequired).toBe(false);
    expect(body.requireReceipts).toBe(false);
  });
});

// ── GET /groups ───────────────────────────────────────────────────────────────
describe("GET /groups", () => {
  it("returns the user's group memberships", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [{ pk: "USER#user-owner", sk: "GROUP_MEMBER#g1", groupId: "g1" }],
    });

    const res = await handler(makeEvent({ routeKey: "GET /groups" }) as any);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).items).toHaveLength(1);
  });
});

// ── GET /groups/:id ───────────────────────────────────────────────────────────
describe("GET /groups/{id}", () => {
  it("returns group details", async () => {
    ddbMock.on(GetCommand).resolves({ Item: SAMPLE_GROUP });

    const res = await handler(
      makeEvent({ routeKey: "GET /groups/{id}", pathParameters: { id: "g1" } }) as any
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).name).toBe("Road Trip");
  });

  it("returns 404 when group not found", async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });

    const res = await handler(
      makeEvent({ routeKey: "GET /groups/{id}", pathParameters: { id: "nonexistent" } }) as any
    );

    expect(res.statusCode).toBe(404);
  });
});

// ── Balance / Debt Minimization Algorithm ─────────────────────────────────────
// These tests target the pure algorithm exported from the handler module.
// We invoke GET /groups/{id}/balances with seeded DDB responses.
describe("GET /groups/{id}/balances — debt minimization", () => {
  function makeBalancesEvent(groupId = "g1") {
    return makeEvent({
      routeKey: "GET /groups/{id}/balances",
      pathParameters: { id: groupId },
    });
  }

  it("returns zero settlements when no approved expenses", async () => {
    ddbMock
      .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
      .on(QueryCommand).resolves({ Items: [] });

    const res = await handler(makeBalancesEvent() as any);
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.settlements).toHaveLength(0);
  });

  it("minimises A→B + B→C to A→C (transitive reduction)", async () => {
    // Alice paid $60, split equally among 3 → Alice is owed $40 (paid $60, owes $20)
    // Bob paid $0 but owes $20 → Bob owes Alice $20
    // Carol paid $0 but owes $20 → Carol owes Alice $20
    const expenses = [
      {
        pk: "GROUP#g1", sk: "EXPENSE#e1",
        ownerId: "user-a",
        amount: 60,
        status: "approved",
        splits: [
          { userId: "user-a", amount: 20 },
          { userId: "user-b", amount: 20 },
          { userId: "user-c", amount: 20 },
        ],
      },
    ];

    ddbMock
      .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
      .on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(makeBalancesEvent() as any);
    const body = JSON.parse(res.body);

    // Alice: paid 60, owed 20 → balance = +40
    // Bob:   paid 0,  owed 20 → balance = -20
    // Carol: paid 0,  owed 20 → balance = -20
    expect(body.balances["user-a"]).toBeCloseTo(40);
    expect(body.balances["user-b"]).toBeCloseTo(-20);
    expect(body.balances["user-c"]).toBeCloseTo(-20);

    // 2 settlements at most (N-1 where N=3 people involved)
    expect(body.settlements.length).toBeLessThanOrEqual(2);

    // Total owed == total owed (net zero)
    const totalPaid = body.settlements.reduce((s: number, t: any) => s + t.amount, 0);
    expect(totalPaid).toBeCloseTo(40);
  });

  it("handles circular debt: A→B $30, B→C $30 → A→C $30 (one transaction)", async () => {
    // A pays $30 owed by B; B pays $30 owed by C
    // Simplified: A owes C $30 directly
    const expenses = [
      {
        pk: "GROUP#g1", sk: "EXPENSE#e2",
        ownerId: "user-b",  // Bob paid $30 for Carol
        amount: 30,
        status: "approved",
        splits: [{ userId: "user-c", amount: 30 }],
      },
      {
        pk: "GROUP#g1", sk: "EXPENSE#e3",
        ownerId: "user-a",  // Alice paid $30 for Bob
        amount: 30,
        status: "approved",
        splits: [{ userId: "user-b", amount: 30 }],
      },
    ];

    ddbMock
      .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
      .on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(makeBalancesEvent() as any);
    const body = JSON.parse(res.body);

    // Alice: paid 30, owes 0 → +30
    // Bob:   paid 30, owes 30 → 0
    // Carol: paid 0,  owes 30 → -30
    expect(body.settlements).toHaveLength(1);
    expect(body.settlements[0].from).toBe("user-c");
    expect(body.settlements[0].to).toBe("user-a");
    expect(body.settlements[0].amount).toBeCloseTo(30);
  });

  it("ignores non-approved expenses in balance calculation", async () => {
    const expenses = [
      {
        pk: "GROUP#g1", sk: "EXPENSE#e4",
        ownerId: "user-a",
        amount: 100,
        status: "pending",  // ← not approved
        splits: [{ userId: "user-b", amount: 100 }],
      },
    ];

    ddbMock
      .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
      .on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(makeBalancesEvent() as any);
    const body = JSON.parse(res.body);

    expect(body.settlements).toHaveLength(0);
    expect(Object.values(body.balances).every((v) => v === 0)).toBe(true);
  });

  it("rounds settlement amounts to 2 decimal places", async () => {
    const expenses = [
      {
        pk: "GROUP#g1", sk: "EXPENSE#e5",
        ownerId: "user-a",
        amount: 10,
        status: "approved",
        splits: [
          { userId: "user-a", amount: 10 / 3 },
          { userId: "user-b", amount: 10 / 3 },
          { userId: "user-c", amount: 10 / 3 },
        ],
      },
    ];

    ddbMock
      .on(GetCommand).resolves({ Item: SAMPLE_GROUP })
      .on(QueryCommand).resolves({ Items: expenses });

    const res = await handler(makeBalancesEvent() as any);
    const body = JSON.parse(res.body);

    for (const s of body.settlements) {
      const decimalPlaces = (s.amount.toString().split(".")[1] || "").length;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    }
  });
});

// ── POST /groups/:id/members ──────────────────────────────────────────────────
describe("POST /groups/{id}/members", () => {
  it("adds member and sends invite email", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-123" });

    const res = await handler(
      makeEvent({
        routeKey: "POST /groups/{id}/members",
        pathParameters: { id: "g1" },
        body: JSON.stringify({ email: "new@test.com", name: "New Member" }),
      }) as any
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).added.email).toBe("new@test.com");
    expect(ddbMock).toHaveReceivedCommand(TransactWriteCommand);
    expect(sesMock).toHaveReceivedCommand(SendEmailCommand);
  });

  it("returns 400 when email is missing", async () => {
    const res = await handler(
      makeEvent({
        routeKey: "POST /groups/{id}/members",
        pathParameters: { id: "g1" },
        body: JSON.stringify({ name: "No Email" }),
      }) as any
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/email/);
  });

  it("succeeds even if SES email fails (swallows error)", async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    sesMock.on(SendEmailCommand).rejects(new Error("SES unavailable"));

    const res = await handler(
      makeEvent({
        routeKey: "POST /groups/{id}/members",
        pathParameters: { id: "g1" },
        body: JSON.stringify({ email: "resilient@test.com" }),
      }) as any
    );

    // Should still succeed — email failure is caught with logger.warn
    expect(res.statusCode).toBe(200);
  });
});