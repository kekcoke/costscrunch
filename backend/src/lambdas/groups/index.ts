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

function groupToResponse(item: Group): Omit<Group, "pk" | "sk" | "gsi1pk" | "gsi1sk" | "entityType"> {
  const { pk, sk, gsi1pk, gsi1sk, entityType, ...rest } = item;
  return rest;
}

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

export function calculateBalances(expenses: any[], members: GroupMember[]): Record<string, number> {
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

export function minimizeTransactions(balances: Record<string, number>): Array<{ from: string; to: string; amount: number }> {
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
  logger.debug("normalizeRoute called", { method, path, routeKey });
  const params: Record<string, string> = {};
  // Extract method from routeKey if method is empty
  if (!method && routeKey) {
    const match = routeKey.match(/^\$default\s+(\w+)/i);
    if (match) method = match[1].toUpperCase();
  }
  const cleanKey = routeKey?.replace(/^\$default\s+/, "") || "";
  const segments = path.split('/').filter(Boolean);
  logger.debug("normalizeRoute resolved", { segments, cleanKey });

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

  return { route: `${method} ${path}`.trim() || cleanKey || '/', params };
}

export { normalizeRoute };

export const rawHandler = async (event: ApiEvent) => {
  logger.debug("rawHandler called", { routeKey: event.routeKey, httpMethod: event.httpMethod });
  let method = (event.httpMethod || event.requestContext?.http?.method || "").toUpperCase();

  if (!method && event.routeKey) {
    const match = event.routeKey.match(/^\$default\s+(\w+)/i);
    if (match) method = match[1].toUpperCase();
  }

  const path = event.path || event.requestContext?.http?.path || "";
  const resourcePath = (event as any).requestContext?.resourcePath;
  const { route, params: pathParams } = normalizeRoute(method, path, event.routeKey || resourcePath);
  logger.debug("Route parsed", { method, path, route, params: pathParams });

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
    return ok(groupToResponse(group), 201);
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
    return ok(groupToResponse(result.Item as Group));
  }

  if (route === "GET /groups/{id}/balances") {
    const [groupRes, expRes] = await Promise.all([
      ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } })),
      ddb.send(new QueryCommand({ TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)", FilterExpression: "#status <> :reimbursed", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#", ":reimbursed": "reimbursed" } }))
    ]);
    if (!groupRes.Item) {
        console.error(`[BALANCES_ERROR] Group ${groupId} not found`);
        return err("Group not found", 404);
    }
    const balances = calculateBalances(expRes.Items || [], groupRes.Item.members || []);
    const settlements = minimizeTransactions(balances);
    logger.debug("Balances calculated", { balancesCount: Object.keys(balances).length, settlementsCount: settlements.length });
    return ok({ balances, settlements });
  }

  if (route === "POST /groups/{id}/settle") {
    let allItems: any[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const expRes = await ddb.send(new QueryCommand({
        TableName: TABLE, KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": `GROUP#${groupId}`, ":prefix": "EXPENSE#" },
        ExclusiveStartKey: lastKey,
      }));
      allItems = allItems.concat(expRes.Items || []);
      lastKey = expRes.LastEvaluatedKey;
    } while (lastKey);

    const approved = allItems.filter(e => e.status === "approved");
    if (approved.length === 0) return err("No approved expenses to settle", 400);
    if (approved.length > 100) return err("Too many expenses to settle at once (max 100)", 422);
    const now = new Date().toISOString();
    await transactWriteWithRetry(ddb, {
      TransactItems: approved.map(exp => ({
        Update: {
          TableName: TABLE,
          Key: { pk: exp.pk, sk: exp.sk },
          UpdateExpression: "SET #status = :s, updatedAt = :now",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: { ":s": "reimbursed", ":now": now },
        },
      })),
    });
    return ok({ message: `Settled ${approved.length} expenses` });
  }

  if (route === "POST /groups/{id}/join") {
    const groupRes = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk: `GROUP#${groupId}`, sk: `PROFILE#${groupId}` } }));
    if (!groupRes.Item) return err("Group not found", 404);
    const group = groupRes.Item as Group;

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

    try {
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
              },
              ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
            }
          }
        ]
      });
    } catch (e: any) {
      if (
        e.name === "TransactionCanceledException" &&
        e.CancellationReasons?.some((r: any) => r.Code === "ConditionalCheckFailed")
      ) {
        return err("Already a member", 409);
      }
      throw e;
    }
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

  return err(`Route not found: ${route}`, 404);
};

export const handler = withLocalAuth(withErrorHandler(rawHandler));
