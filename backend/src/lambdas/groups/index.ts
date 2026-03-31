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

function calculateBalances(expenses: any[], members: GroupMember[]): Record<string, number> {
  const paid: Record<string, number> = {};
  const owed: Record<string, number> = {};
  for (const m of members) { paid[m.userId] = 0; owed[m.userId] = 0; }
  for (const exp of expenses) {
    if (exp.status === "approved" && exp.splits) {
      paid[exp.ownerId] = (paid[exp.ownerId] || 0) + exp.amount;
      for (const split of exp.splits) {
        owed[split.userId] = (owed[split.userId] || 0) + split.amount;
      }
    }
  }
  const balances: Record<string, number> = {};
  for (const userId of Object.keys(paid)) { balances[userId] = (paid[userId] || 0) - (owed[userId] || 0); }
  return balances;
}

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
    transactions.push({ from: debtors[i].id, to: creditors[j].id, amount: Math.round(amount * 100) / 100 });
    debtors[i].amount -= amount; creditors[j].amount -= amount;
    if (debtors[i].amount < 0.01) i++;
    if (creditors[j].amount < 0.01) j++;
  }
  return transactions;
}

function normalizeRoute(method: string, path: string, routeKey?: string): { route: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const segments = path.split('/').filter(Boolean);
  const p = path.toLowerCase();

  // 1. Identify 'groups' and action segments
  const gIdx = segments.findIndex(s => s.toLowerCase() === 'groups');
  const settleIdx = segments.findIndex(s => s.toLowerCase() === 'settle');
  const joinIdx = segments.findIndex(s => s.toLowerCase() === 'join');
  const balancesIdx = segments.findIndex(s => s.toLowerCase() === 'balances');
  const membersIdx = segments.findIndex(s => s.toLowerCase() === 'members');

  // 2. Extract ID: prefer segment between 'groups' and action, or after 'groups'
  if (gIdx !== -1) {
    if (settleIdx > gIdx) params.id = segments[settleIdx - 1];
    else if (joinIdx > gIdx) params.id = segments[joinIdx - 1];
    else if (balancesIdx > gIdx) params.id = segments[balancesIdx - 1];
    else if (membersIdx > gIdx) params.id = segments[membersIdx - 1];
    else params.id = segments[gIdx + 1];
  }

  // 3. Resolve Route based on segments present
  if (settleIdx !== -1) return { route: "POST /groups/{id}/settle", params };
  if (joinIdx !== -1) return { route: "POST /groups/{id}/join", params };
  if (balancesIdx !== -1) return { route: "GET /groups/{id}/balances", params };
  if (membersIdx !== -1) {
    if (segments[membersIdx + 1]) {
      params.userId = segments[membersIdx + 1];
      return { route: `${method} /groups/{id}/members/{userId}`, params };
    }
    return { route: `${method} /groups/{id}/members`, params };
  }

  if (params.id) return { route: `${method} /groups/{id}`, params };
  if (gIdx !== -1) return { route: `${method} /groups`, params };

  return { route: routeKey || `${method} ${path}`, params };
}

export const rawHandler = async (event: ApiEvent) => {
  console.log("RAW_EVENT_LOG:", JSON.stringify(event));
  const method = event.httpMethod || event.requestContext?.http?.method || "";
  const path = event.path || event.requestContext?.http?.path || "";
  // Fallback to resourcePath if the raw path fails to match in LocalStack
  const resourcePath = (event as any).requestContext?.resourcePath;
  const { route, params: pathParams } = normalizeRoute(method, path, event.routeKey || resourcePath);
  
  // Debug log to catch exactly why routes aren't matching
  console.log(`[ROUTE_CHECK] method=${method} path=${path} route=${route} params=${JSON.stringify(pathParams)}`);

  let auth;
  try { auth = getAuth(event); } catch (e) { return err("Unauthorized", 401); }

  // Ensure pathParams from our custom logic take precedence over potentially mangled GW pathParameters
  const mergedParams = { ...event.pathParameters, ...pathParams };
  const groupId = mergedParams.id;
  const memberUserId = mergedParams.userId;

  if (route.includes("POST /groups") && !groupId) {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = createGroupSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));
    const body = parsed.data;
    const id = ulid();
    const now = new Date().toISOString();
    const group: Group = {
      pk: `GROUP#${id}`, sk: `PROFILE#${id}`, gsi1pk: `OWNER#${auth.userId}`, gsi1sk: `GROUP#${id}`,
      entityType: "GROUP", groupId: id, name: body.name, type: body.type, ownerId: auth.userId,
      members: [{ userId: auth.userId, name: auth.email.split('@')[0], email: auth.email, role: "owner", joinedAt: now, totalSpend: 0, balance: 0 }],
      memberCount: 1, budgets: body.budgets ?? [], currency: body.currency, active: true, createdAt: now, updatedAt: now,
    };
    await transactWriteWithRetry(ddb, {
      TransactItems: [
        { Put: { TableName: TABLE, Item: group, ConditionExpression: "attribute_not_exists(pk)" } },
        { Put: { TableName: TABLE, Item: { pk: `USER#${auth.userId}`, sk: `GROUP_MEMBER#${id}`, entityType: "GROUP_MEMBER", groupId: id, name: body.name, userId: auth.userId, role: "owner", joinedAt: now } } }
      ]
    });
    return ok(group, 201);
  }

  if (route.includes("GET /groups") && !groupId) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "active <> :false", ExpressionAttributeValues: { ":pk": `USER#${auth.userId}`, ":prefix": "GROUP_MEMBER#", ":false": false }
    }));
    return ok({ items: result.Items || [] });
  }

  if (route.includes("GET /groups/{id}") && groupId) {
    const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } }));
    if (!result.Item) return err("Group not found", 404);
    return ok(result.Item);
  }

  if (route.includes("/balances") && groupId) {
    const [groupRes, expRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" } }))
    ]);
    if (!groupRes.Item) return err("Group not found", 404);
    const balances = calculateBalances(expRes.Items || [], groupRes.Item.members);
    return ok({ balances, settlements: minimizeTransactions(balances) });
  }

  if (route.includes("/settle") && groupId) {
    const expRes = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" }
    }));
    const approved = (expRes.Items || []).filter(e => e.status === "approved");
    if (approved.length === 0) return err("No approved expenses to settle", 400);
    const now = new Date().toISOString();
    await Promise.all(approved.map(exp => ddb.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: exp.pk, sk: exp.sk },
      UpdateExpression: "SET #status = :s, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":s": "reimbursed", ":now": now }
    }))));
    return ok({ message: `Settled ${approved.length} expenses` });
  }

  if (route.includes("/join") && groupId) {
    const groupRes = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } }));
    if (!groupRes.Item) return err("Group not found", 404);
    const group = groupRes.Item as Group;
    
    if (group.members.some(m => m.userId === auth.userId)) {
      return err("Already a member", 400);
    }

    const now = new Date().toISOString();
    const newMember: GroupMember = {
      userId: auth.userId,
      name: auth.email.split('@')[0],
      email: auth.email,
      role: "member",
      joinedAt: now,
      totalSpend: 0,
      balance: 0,
    };

    await transactWriteWithRetry(ddb, {
      TransactItems: [
        {
          Update: {
            TableName: TABLE,
            Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` },
            UpdateExpression: "SET members = list_append(members, :m), memberCount = memberCount + :one, updatedAt = :now",
            ExpressionAttributeValues: { ":m": [newMember], ":one": 1, ":now": now }
          }
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: `USER#${auth.userId}`,
              sk: `GROUP_MEMBER#${groupId}`,
              entityType: "GROUP_MEMBER",
              groupId,
              name: group.name,
              userId: auth.userId,
              role: "member",
              joinedAt: now
            }
          }
        }
      ]
    });
    return ok({ joined: true, groupId });
  }

  if (route === "DELETE /groups/{id}" && groupId) {
    const [groupRes, expRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" } }))
    ]);
    if (!groupRes.Item) return err("Group not found", 404);
    if (groupRes.Item.ownerId !== auth.userId) return err("Only owner can delete", 403);
    const balances = calculateBalances(expRes.Items || [], groupRes.Item.members);
    if (Object.values(balances).some(b => Math.abs(b) > 0.01)) return err("Outstanding balances", 400);
    const now = new Date().toISOString();
    await transactWriteWithRetry(ddb, {
      TransactItems: [
        { Update: { TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` }, UpdateExpression: "SET active = :false, deletedAt = :now", ExpressionAttributeValues: { ":false": false, ":now": now } } },
        { Update: { TableName: TABLE, Key: { pk: `USER#${auth.userId}`, sk: `GROUP_MEMBER#${groupId}` }, UpdateExpression: "SET active = :false", ExpressionAttributeValues: { ":false": false } } }
      ]
    });
    return ok({ deleted: true });
  }

  return err(`Route not found: ${route} (groupId: ${groupId})`, 404);
};

export const handler = withLocalAuth(withErrorHandler(rawHandler));
