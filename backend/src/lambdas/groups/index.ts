// ─── CostsCrunch — Groups Lambda Handler ───────────────────────────────────────
// Routes: POST /groups, GET /groups, GET /groups/:id, PATCH /groups/:id
//         POST /groups/:id/members, DELETE /groups/:id/members/:userId
//         POST /groups/:id/settle, GET /groups/:id/balances

import { GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient, baseConfig } from "../../utils/awsClients.js";
import { transactWriteWithRetry } from "../../utils/transactWriteWithRetry.js";
import { SESClient } from "@aws-sdk/client-ses";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { ulid } from "ulid";
import type { ApiEvent, Group, GroupMember } from "../../shared/models/types.js";
import { createGroupSchema } from "../../shared/validation/schemas.js";

const ddb = createDynamoDBDocClient();
const ses = new SESClient(baseConfig());
const TABLE = process.env.TABLE_NAME_MAIN!;

const logger = new Logger({ serviceName: "groups" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "groups" });

const ok = (body: unknown, statusCode = 200) => ({
  statusCode, 
  body: JSON.stringify(body),
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
});

const err = (msg: string, statusCode = 400) => ({
  statusCode, 
  body: JSON.stringify({ error: msg }),
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
});

function calculateBalances(expenses: any[], members: GroupMember[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const m of members) { balances[m.userId] = 0; }
  
  for (const exp of expenses) {
    if (exp.status === "approved" && exp.splits) {
      balances[exp.ownerId] = (balances[exp.ownerId] || 0) + exp.amount;
      for (const split of exp.splits) {
        balances[split.userId] = (balances[split.userId] || 0) - split.amount;
      }
    }
  }
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
  console.log(`[normalizeRoute] method=${method}, path=${path}, routeKey=${routeKey}`);
  const params: Record<string, string> = {};
  const cleanKey = routeKey?.replace(/^\$default\s+/, "") || "";
  const segments = path.split('/').filter(Boolean);
  console.log(`[normalizeRoute] segments=${JSON.stringify(segments)}, cleanKey=${cleanKey}`);

  const gIdx = segments.findIndex(s => s.toLowerCase() === 'groups');
  const settleIdx = segments.findIndex(s => s.toLowerCase() === 'settle');
  const joinIdx = segments.findIndex(s => s.toLowerCase() === 'join');
  const balancesIdx = segments.findIndex(s => s.toLowerCase() === 'balances');
  const membersIdx = segments.findIndex(s => s.toLowerCase() === 'members');

  if (gIdx !== -1) {
    const nextSeg = segments[gIdx + 1];
    if (nextSeg && !['settle', 'join', 'balances', 'members'].includes(nextSeg.toLowerCase())) {
        params.id = nextSeg;
    } else if (gIdx > 0 && segments[gIdx-1] !== 'restapis') {
        // Fallback for cases where ID might be before 'groups' in some mangled paths
        // but usually it's /groups/{id}/action
    }
  }

  if (cleanKey.includes("/balances") || balancesIdx !== -1) return { route: "GET /groups/{id}/balances", params };
  if (cleanKey.includes("/settle") || settleIdx !== -1) return { route: "POST /groups/{id}/settle", params };
  if (cleanKey.includes("/join") || joinIdx !== -1) return { route: "POST /groups/{id}/join", params };
  
  if (membersIdx !== -1) {
    if (segments[membersIdx + 1]) {
      params.userId = segments[membersIdx + 1];
      return { route: `${method} /groups/{id}/members/{userId}`, params };
    }
    return { route: `${method} /groups/{id}/members`, params };
  }

  if (params.id && params.id !== "groups") return { route: `${method.toUpperCase()} /groups/{id}`, params };
  if (gIdx !== -1 || cleanKey.includes("/groups")) {
      // If we have a segment after /groups, it's an ID
      if (segments[gIdx + 1]) {
          params.id = segments[gIdx + 1];
          return { route: `${method.toUpperCase()} /groups/{id}`, params };
      }
      return { route: `${method.toUpperCase()} /groups`, params: {} };
  }

  return { route: routeKey || `${method} ${path}`, params };
}

export const rawHandler = async (event: ApiEvent) => {
  console.log(`[DEBUG] rawHandler called. routeKey: ${event.routeKey}, httpMethod: ${event.httpMethod}`);
  const method = (event.httpMethod || event.requestContext?.http?.method || "").toUpperCase();
  const path = event.path || event.requestContext?.http?.path || "";
  const resourcePath = (event as any).requestContext?.resourcePath;
  const { route, params: pathParams } = normalizeRoute(method, path, event.routeKey || resourcePath);
  console.log(`[DEBUG] Parsed: method=${method}, path=${path}, route=${route}, params=${JSON.stringify(pathParams)}`);
  
  if (process.env.VITEST || process.env.DEBUG_LOGS) {
    console.log(`[DEBUG] Groups Route: "${route}", Params: ${JSON.stringify(pathParams)}, Method: ${method}, Path: ${path}`);
  }

  let auth;
  try { auth = getAuth(event); } catch (e) { return err("Unauthorized", 401); }

  const mergedParams = { ...pathParams, ...event.pathParameters };
  const groupId = mergedParams.id;

  if (route === "POST /groups") {
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

  if (route === "GET /groups") {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "active <> :false", ExpressionAttributeValues: { ":pk": `USER#${auth.userId}`, ":prefix": "GROUP_MEMBER#", ":false": false }
    }));
    return ok({ items: result.Items || [] });
  }

  if (route === "GET /groups/{id}") {
    const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } }));
    if (!result.Item) return err("Group not found", 404);
    return ok(result.Item);
  }

  if (route === "GET /groups/{id}/balances") {
    const [groupRes, expRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" } }))
    ]);
    if (!groupRes.Item) {
        console.error(`[BALANCES_ERROR] Group ${groupId} not found`);
        return err("Group not found", 404);
    }
    const balances = calculateBalances(expRes.Items || [], groupRes.Item.members || []);
    const settlements = minimizeTransactions(balances);
    console.log(`[DEBUG] Balances count: ${Object.keys(balances).length}, Settlements: ${settlements.length}`);
    return ok({ balances, settlements });
  }

  if (route === "POST /groups/{id}/settle") {
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

  if (route === "POST /groups/{id}/join") {
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

  if (route === "DELETE /groups/{id}") {
    const [groupRes, expRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" } }))
    ]);
    if (!groupRes.Item) return err("Group not found", 404);
    if (groupRes.Item.ownerId !== auth.userId) return err("Only owner can delete", 403);
    const balances = calculateBalances(expRes.Items || [], groupRes.Item.members || []);
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

  // Temporarily return the actual route to debug
  return { statusCode: 500, body: JSON.stringify({ debug: true, route, groupId, path, routeKey: event.routeKey }), headers: { "Content-Type": "application/json" } };
};

export const handler = withLocalAuth(withErrorHandler(rawHandler));
