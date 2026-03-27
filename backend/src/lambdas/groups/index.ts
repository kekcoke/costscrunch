// ─── CostsCrunch — Groups Lambda Handler ───────────────────────────────────────
// Routes: POST /groups, GET /groups, GET /groups/:id, PATCH /groups/:id
//         POST /groups/:id/members, DELETE /groups/:id/members/:userId
//         POST /groups/:id/settle, GET /groups/:id/balances

import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient, baseConfig } from "../../utils/awsClients.js";
import { transactWriteWithRetry } from "../../utils/transactWriteWithRetry.js";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { ulid } from "ulid";
import type { ApiEvent, Group, GroupMember } from "../../shared/models/types.js";
import { createGroupSchema, updateGroupSchema, addGroupMemberSchema } from "../../shared/validation/schemas.js";
const ddb = createDynamoDBDocClient();
const ses = new SESClient(baseConfig());
const TABLE = process.env.TABLE_NAME_MAIN!;
const FROM_EMAIL = process.env.FROM_EMAIL!;

const logger = new Logger({ serviceName: "groups" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "groups" });

const ok = (body: unknown, statusCode = 200) => ({
  statusCode, body: JSON.stringify(body),
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
});
const err = (msg: string, statusCode = 400) => ({
  statusCode, body: JSON.stringify({ error: msg }),
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
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

// ─── Path matcher for REST API v1 ─────────────────────────────────────────────
// REST API v1 sends actual paths ("/groups/g1"), not template patterns ("/groups/{id}").
// This normalizes the route so the handler can use a single set of route checks.
function normalizeRoute(method: string, path: string, routeKey?: string): { route: string; params: Record<string, string> } {
  if (routeKey) return { route: routeKey, params: {} };

  // Strip trailing slash
  const p = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
  const segments = p.split("/").filter(Boolean); // e.g. ["groups", "g1", "balances"]

  const params: Record<string, string> = {};

  // Match known patterns (most specific first)
  if (segments.length === 4 && segments[0] === "groups" && segments[2] === "members") {
    params.id = segments[1]; params.userId = segments[3];
    return { route: `${method} /groups/{id}/members/{userId}`, params };
  }
  if (segments.length === 3 && segments[0] === "groups" && segments[2] === "members") {
    params.id = segments[1];
    return { route: `${method} /groups/{id}/members`, params };
  }
  if (segments.length === 3 && segments[0] === "groups" && segments[2] === "balances") {
    params.id = segments[1];
    return { route: `${method} /groups/{id}/balances`, params };
  }
  if (segments.length === 3 && segments[0] === "groups" && segments[2] === "settle") {
    params.id = segments[1];
    return { route: `${method} /groups/{id}/settle`, params };
  }
  if (segments.length === 2 && segments[0] === "groups") {
    params.id = segments[1];
    return { route: `${method} /groups/{id}`, params };
  }
  if (segments.length === 1 && segments[0] === "groups") {
    return { route: `${method} /groups`, params };
  }

  return { route: `${method} ${p}`, params };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const rawHandler = async (event: ApiEvent) => {
  // Support both HTTP API v2 (routeKey) and REST API v1 (httpMethod + path)
  const method = event.httpMethod || event.requestContext?.http?.method || "";
  const path = event.path || event.requestContext?.http?.path || "";
  const { route, params: pathParams } = normalizeRoute(method, path, event.routeKey);

  let auth;
  try {
    auth = getAuth(event);
  } catch (e) {
    logger.warn("Auth extraction failed", { 
      authorizer: event.requestContext?.authorizer,
      env: process.env.MOCK_AUTH 
    });
    return err("Unauthorized", 401);
  }

  // Prefer explicit pathParameters (from HTTP API v2 / Express adapter), fall back to parsed params
  const mergedParams = { ...pathParams, ...event.pathParameters };
  const groupId = mergedParams.id;
  const memberUserId = mergedParams.userId;

  logger.appendKeys({ userId: auth.userId, route, groupId });

  // ── POST /groups ──────────────────────────────────────────────────────────
  if (route === "POST /groups") {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = createGroupSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const id = ulid();
    const now = new Date().toISOString();
    const initialMember: GroupMember = {
      userId: auth.userId,
      name: auth.email.split('@')[0] || "Owner",
      email: auth.email,
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
      type: body.type,
      ownerId: auth.userId,
      color: body.color,
      iconEmoji: body.iconEmoji,
      members: [initialMember],
      memberCount: 1,
      budgets: body.budgets ?? [],
      currency: body.currency,
      approvalRequired: body.approvalRequired,
      approvalThreshold: body.approvalThreshold,
      requireReceipts: body.requireReceipts,
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

    // Transactionally create group and owner membership
    await transactWriteWithRetry(ddb, {
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: group,
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: `USER#${auth.userId}`,
              sk: `GROUP_MEMBER#${id}`,
              entityType: "GROUP_MEMBER",
              groupId: id,
              name: body.name,
              userId: auth.userId,
              role: "owner",
              joinedAt: now,
            },
          },
        },
      ],
    });

    metrics.addMetric("GroupCreated", MetricUnit.Count, 1);
    return ok(group, 201);
  }

  // ── GET /groups ───────────────────────────────────────────────────────────
  if (route === "GET /groups") {
    // Get all active groups where user is a member
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "active <> :false",
      ExpressionAttributeValues: {
        ":pk": `USER#${auth.userId}`,
        ":prefix": "GROUP_MEMBER#",
        ":false": false,
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

  // ── PATCH /groups/:id ────────────────────────────────────────────────────
  if (route === "PATCH /groups/{id}" && groupId) {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = updateGroupSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const now = new Date().toISOString();

    const updates: string[] = ["updatedAt = :now"];
    const values: Record<string, any> = { ":now": now };
    const names: Record<string, string> = {};

    // Dynamically build update expression for Zod-validated fields
    const allowedFields = ["name", "description", "type", "color", "iconEmoji", "currency",
      "approvalRequired", "approvalThreshold", "requireReceipts", "requireReceiptsAbove",
      "policyId", "costCenters", "projectCodes", "budgets", "active"] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`#${field} = :${field}`);
        names[`#${field}`] = field;
        values[`:${field}`] = body[field];
      }
    }

    if (updates.length === 1) return err("No valid fields to update");

    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
      ConditionExpression: "attribute_exists(pk)",
    }));

    metrics.addMetric("GroupUpdated", MetricUnit.Count, 1);
    return ok(result.Attributes);
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
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = addGroupMemberSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    
    // Fetch group profile to get name for denormalization
    const groupResult = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
    }));
    const groupProfile = groupResult.Item;
    if (!groupProfile) return err("Group not found", 404);

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
    await transactWriteWithRetry(ddb, {
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
              groupId,
              name: groupProfile.name,
              role: newMember.role,
              joinedAt: now,
            },
          },
        },
      ],
    });

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

  // ── DELETE /groups/:id/members/:userId ───────────────────────────────
  if (route === "DELETE /groups/{id}/members/{userId}" && groupId && memberUserId) {
    // 1. Get Group and Expenses to check balances
    const [groupRes, expensesRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" },
      })),
    ]);

    const group = groupRes.Item as Group;
    if (!group) return err("Group not found", 404);

    // 2. Find member index in the denormalized list
    const memberIndex = group.members.findIndex(m => m.userId === memberUserId);
    if (memberIndex === -1) return err("Member not found in group", 404);

    // 3. Prevent removing the owner
    if (group.members[memberIndex].role === "owner") {
      return err("Cannot remove the group owner", 403);
    }

    // 4. Integrity check: Balance must be zero
    const balances = calculateBalances(expensesRes.Items || [], group.members);
    const userBalance = balances[memberUserId] || 0;
    if (Math.abs(userBalance) > 0.01) {
      return err(`Cannot remove member with unsettled balance (${userBalance.toFixed(2)})`, 400);
    }

    // 5. Atomic removal
    await transactWriteWithRetry(ddb, {
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
            UpdateExpression: `REMOVE members[${memberIndex}] SET memberCount = memberCount - :one, updatedAt = :now`,
            ConditionExpression: `members[${memberIndex}].userId = :uid`,
            ExpressionAttributeValues: { 
              ":one": 1, 
              ":now": new Date().toISOString(),
              ":uid": memberUserId 
            },
          },
        },
        {
          Delete: {
            TableName: TABLE,
            Key: { pk: `USER#${memberUserId}`, sk: `GROUP_MEMBER#${groupId}` },
          },
        },
      ],
    });

    metrics.addMetric("MemberRemoved", MetricUnit.Count, 1);
    return ok({ deleted: true });
  }

  // ── DELETE /groups/:id ────────────────────────────────────────────────────
  if (route === "DELETE /groups/{id}" && groupId) {
    const [groupRes, expensesRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" },
      })),
    ]);

    const group = groupRes.Item as Group;
    if (!group) return err("Group not found", 404);

    // 1. Must be owner
    if (group.ownerId !== auth.userId) {
      return err("Only the group owner can delete the group", 403);
    }

    const expenses = expensesRes.Items || [];

    // 2. No pending expenses
    const hasPending = expenses.some(e => e.status === "pending");
    if (hasPending) {
      return err("Cannot delete group with pending expenses. Please approve or reject them first.", 400);
    }

    // 3. No outstanding dues (balances must be zero)
    const balances = calculateBalances(expenses, group.members);
    const hasDues = Object.values(balances).some(b => Math.abs(b) > 0.01);
    if (hasDues) {
      return err("Cannot delete group with outstanding balances. All members must be settled.", 400);
    }

    // 4. Soft delete (set active = false) for both Profile and Membership
    const now = new Date().toISOString();
    await transactWriteWithRetry(ddb, {
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
            UpdateExpression: "SET active = :false, updatedAt = :now, deletedAt = :now",
            ExpressionAttributeValues: { ":false": false, ":now": now },
            ConditionExpression: "attribute_exists(pk)",
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `USER#${auth.userId}`, sk: `GROUP_MEMBER#${groupId}` },
            UpdateExpression: "SET active = :false",
            ExpressionAttributeValues: { ":false": false },
            ConditionExpression: "attribute_exists(pk)",
          },
        },
      ],
    });

    metrics.addMetric("GroupDeleted", MetricUnit.Count, 1);
    return ok({ deleted: true });
  }

  return err("Route not found", 404);
};

export const handler = withLocalAuth(withErrorHandler(rawHandler));