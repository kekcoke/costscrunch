// ─── CostsCrunch — Groups Lambda Handler ───────────────────────────────────────
// Routes: POST /groups, GET /groups, GET /groups/:id, PATCH /groups/:id
//         POST /groups/:id/members, DELETE /groups/:id/members/:userId
//         POST /groups/:id/settle, GET /groups/:id/balances

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { ulid } from "ulid";
import type { ApiEvent, Group, GroupMember } from "../../shared/models/types.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ses = new SESClient({});
const TABLE = process.env.TABLE_NAME_MAIN!;
const FROM_EMAIL = process.env.FROM_EMAIL!;

const logger = new Logger({ serviceName: "groups" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "groups" });

const ok = (body: unknown, statusCode = 200) => ({
  statusCode, body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});
const err = (msg: string, statusCode = 400) => ({
  statusCode, body: JSON.stringify({ error: msg }),
  headers: { "Content-Type": "application/json" },
});

// ─── Balance Calculator ───────────────────────────────────────────────────────
// Uses simplified debt reduction algorithm
function calculateBalances(expenses: any[], members: GroupMember[]): Record<string, number> {
  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};

  for (const m of members) {
    paid[m.userId] = 0;
    owed[m.userId] = 0;
  }

  for (const exp of expenses) {
    if (exp.status === "approved" && exp.splits) {
      paid[exp.ownerId] = (paid[exp.ownerId] || 0) + exp.amount;
      for (const split of exp.splits) {
        owed[split.userId] = (owed[split.userId] || 0) + split.amount;
      }
    }
  }

  const balances: Record<string, number> = {};
  for (const userId of Object.keys(paid)) {
    balances[userId] = (paid[userId] || 0) - (owed[userId] || 0);
  }
  return balances;
}

// ─── Simplified Debt Resolution ───────────────────────────────────────────────
// Reduces N*(N-1)/2 transactions to at most N-1
function minimizeTransactions(balances: Record<string, number>): Array<{ from: string; to: string; amount: number }> {
  const creditors: { id: string; amount: number }[] = [];
  const debtors: { id: string; amount: number }[] = [];

  for (const [id, balance] of Object.entries(balances)) {
    if (balance > 0.01) creditors.push({ id, amount: balance });
    else if (balance < -0.01) debtors.push({ id, amount: Math.abs(balance) });
  }

  const transactions: Array<{ from: string; to: string; amount: number }> = [];

  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    transactions.push({
      from: debtors[i].id,
      to: creditors[j].id,
      amount: Math.round(amount * 100) / 100,
    });
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }

  return transactions;
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const handler = async (event: ApiEvent & { routeKey?: string; httpMethod?: string }) => {
  const route = event.routeKey || "";
  const auth = { userId: event.requestContext.authorizer.jwt.claims.sub };
  const { id: groupId, userId: memberUserId } = event.pathParameters || {};

  logger.appendKeys({ userId: auth.userId, route, groupId });

  // ── POST /groups ──────────────────────────────────────────────────────────
  if (route === "POST /groups") {
    const body = JSON.parse(event.body || "{}");
    if (!body.name) return err("name is required");

    const id = ulid();
    const now = new Date().toISOString();
    const initialMember: GroupMember = {
      userId: auth.userId,
      name: body.ownerName || "Owner",
      email: body.ownerEmail || "",
      role: "owner",
      joinedAt: now,
      totalSpend: 0,
      balance: 0,
    };

    const group: Group = {
      pk: `GROUP#${id}`,
      sk: `PROFILE#${id}`,
      gsi1pk: `OWNER#${auth.userId}`,
      gsi1sk: `GROUP#${id}`,
      entityType: "GROUP",
      groupId: id,
      name: body.name,
      description: body.description,
      type: body.type || "personal",
      ownerId: auth.userId,
      color: body.color || "#6366f1",
      iconEmoji: body.iconEmoji,
      members: [initialMember],
      memberCount: 1,
      budgets: body.budgets || [],
      currency: body.currency || "USD",
      approvalRequired: body.approvalRequired ?? false,
      approvalThreshold: body.approvalThreshold,
      requireReceipts: body.requireReceipts ?? false,
      requireReceiptsAbove: body.requireReceiptsAbove,
      policyId: body.policyId,
      costCenters: body.costCenters,
      projectCodes: body.projectCodes,
      totalSpend: 0,
      monthSpend: 0,
      expenseCount: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: group, ConditionExpression: "attribute_not_exists(pk)" }));
    metrics.addMetric("GroupCreated", MetricUnit.Count, 1);
    return ok(group, 201);
  }

  // ── GET /groups ───────────────────────────────────────────────────────────
  if (route === "GET /groups") {
    // Get all groups where user is a member (stored as USER#userId / GROUP_MEMBER#groupId)
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${auth.userId}`,
        ":prefix": "GROUP_MEMBER#",
      },
    }));
    return ok({ items: result.Items || [] });
  }

  // ── GET /groups/:id ───────────────────────────────────────────────────────
  if (route === "GET /groups/{id}" && groupId) {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
    }));
    if (!result.Item) return err("Group not found", 404);
    return ok(result.Item);
  }

  // ── GET /groups/:id/balances ──────────────────────────────────────────────
  if (route === "GET /groups/{id}/balances" && groupId) {
    const [groupResult, expensesResult] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" },
      })),
    ]);

    if (!groupResult.Item) return err("Group not found", 404);
    const group = groupResult.Item as Group;
    const expenses = expensesResult.Items || [];

    const balances = calculateBalances(expenses, group.members);
    const settlements = minimizeTransactions(balances);

    return ok({ balances, settlements, memberCount: group.memberCount });
  }

  // ── POST /groups/:id/members ──────────────────────────────────────────────
  if (route === "POST /groups/{id}/members" && groupId) {
    const body = JSON.parse(event.body || "{}");
    if (!body.email) return err("email is required");

    const now = new Date().toISOString();
    const newMember: GroupMember = {
      userId: body.userId || `pending:${body.email}`,
      name: body.name || body.email,
      email: body.email,
      role: body.role || "member",
      joinedAt: now,
      totalSpend: 0,
      balance: 0,
    };

    // Transactionally add member to group and write member record
    await ddb.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
            UpdateExpression: "SET members = list_append(members, :m), memberCount = memberCount + :one, updatedAt = :now",
            ExpressionAttributeValues: { ":m": [newMember], ":one": 1, ":now": now },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: `USER#${newMember.userId}`,
              sk: `GROUP_MEMBER#${groupId}`,
              groupId, groupName: "pending", role: newMember.role, joinedAt: now,
            },
          },
        },
      ],
    }));

    // Send invite email via SES
    try {
      await ses.send(new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [body.email] },
        Message: {
          Subject: { Data: `You've been added to a CostsCrunch group` },
          Body: {
            Html: {
              Data: `<p>You've been invited to join a group on CostsCrunch. <a href="https://app.costscrunch.io/join/${groupId}">Click here to accept</a></p>`,
            },
          },
        },
      }));
    } catch (e) {
      logger.warn("Email send failed", { error: e });
    }

    metrics.addMetric("MemberAdded", MetricUnit.Count, 1);
    return ok({ added: newMember });
  }

  return err("Route not found", 404);
};