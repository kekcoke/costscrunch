// ─── CostsCrunch — Expenses Lambda Handler ─────────────────────────────────────
// Routes: GET /expenses, POST /expenses, GET /expenses/:id, PATCH /expenses/:id,
//         DELETE /expenses/:id
// NOTE: GET /expenses/export is handled by the dedicated expense-export Lambda,
//       not this one (SUG-006) — see ApiConstruct.ts for the API Gateway route.

import {
  GetCommand, PutCommand,
  QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { ulid } from "ulid";
import type {
  ApiEvent, AuthContext,
  Expense,
} from "../../shared/models/types.js";
import { createExpenseSchema, updateExpenseSchema, getExpensesQuerySchema } from "../../shared/validation/schemas.js";
import { validateQuery } from "../../shared/validation/middleware.js";

/**
 * Path matcher for REST API v1.
 */
function normalizeRoute(method: string, path: string, routeKey?: string): { route: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const p = path.toLowerCase();
  const cleanKey = routeKey?.replace(/^\$default\s+/, "") || "";

  if (cleanKey.includes("/expenses/export") || p.includes("/expenses/export")) {
    return { route: "GET /expenses/export", params: {} };
  }

  const idMatch = path.match(/\/expenses\/([^/?#]+)/i);
  const isItemRoute = cleanKey.includes("{id}") || (idMatch && idMatch[1] !== "export" && idMatch[1] !== "expenses");

  if (isItemRoute) {
    if (idMatch && idMatch[1] && idMatch[1] !== "{id}") {
      params.id = idMatch[1];
    }
    return { route: `${method} /expenses/{id}`, params };
  }

  if (cleanKey.includes("/expenses") || p.includes("/expenses")) {
    return { route: `${method} /expenses`, params: {} };
  }

  return { route: `${method} ${path}`, params };
}

const ddb = createDynamoDBDocClient({
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME_MAIN!;

const logger = new Logger({ serviceName: "expenses" });
const tracer = new Tracer({ serviceName: "expenses" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "expenses" });

export const toResponse = (item: any) => {
  if (!item || typeof item !== "object") return item;
  if (item.expenseId || item.id || item.sk?.startsWith("EXPENSE#")) {
    const id = item.id || item.expenseId || item.sk?.split("#")[1];
    return { 
      ...item, 
      id, 
      expenseId: id,
      receipt: !!item.receiptKey || !!item.receipt
    };
  }
  return item;
};

const ok = (body: unknown, statusCode = 200, headers: Record<string, string> = {}) => {
  let normalizedBody = body;
  if (Array.isArray(body)) {
    normalizedBody = body.map(toResponse);
  } else if (typeof body === "object" && body !== null) {
    const b = body as any;
    if (b.items && Array.isArray(b.items)) {
      normalizedBody = { ...b, items: b.items.map(toResponse) };
    } else {
      normalizedBody = toResponse(b);
    }
  }

  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": ulid(),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
      ...headers,
    },
    body: typeof normalizedBody === "string" ? normalizedBody : JSON.stringify(normalizedBody),
  };
};

const err = (msg: string, statusCode = 400) => ({
  statusCode, 
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
  body: JSON.stringify({ error: msg }),
});

export function buildExpenseKeys(userId: string, expenseId: string, expense: Partial<Expense> & { groupId?: string }) {
  return {
    pk: expense.groupId ? `GROUP#${expense.groupId}` : `USER#${userId}`,
    sk: `EXPENSE#${expenseId}`,
    gsi1pk: `STATUS#${expense.status || "draft"}`,
    gsi1sk: `DATE#${expense.date}#${expenseId}`,
    gsi2pk: `CATEGORY#${expense.category}`,
    gsi2sk: `DATE#${expense.date}#${expenseId}`,
  };
}

export const rawHandler = withLocalAuth(withErrorHandler(async (event: ApiEvent & { httpMethod?: string; routeKey?: string }) => {
  const rawRouteKey = event.routeKey || (event as any).requestContext?.resourcePath || "";
  const routeKey = rawRouteKey.replace(/^\$default\s+/, "");
  
  const methodFromKey = (routeKey.includes(" ") ? routeKey.split(" ")[0] : "").toUpperCase();
  const method = methodFromKey || (event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
  const path = event.path || event.requestContext?.http?.path || "/";
  
  const { route, params: pathParams } = normalizeRoute(method, path, routeKey);
  
  let auth;
  try {
    auth = getAuth(event);
    if (process.env.MOCK_AUTH === 'true' && (auth.userId === "local-user-uuid-123" || !auth.userId)) {
      auth.userId = "test-user-001";
    }
  } catch (e) {
    return err("Unauthorized", 401);
  }

  const mergedParams = { ...pathParams, ...event.pathParameters };
  const expenseId = mergedParams.id;

  logger.appendKeys({ userId: auth.userId, route });

  // NOTE: GET /expenses/export is owned exclusively by the dedicated
  // expense-export Lambda (see backend/src/lambdas/expense-export/index.ts).
  // It is routed there directly by API Gateway (see ApiConstruct.ts /
  // SAM templates) and must not be duplicated here (SUG-006).

  // ── GET /expenses (List) ───────────────────────────────────────────────────
  if (route === "GET /expenses") {
    const parsed = validateQuery(getExpensesQuerySchema, event.queryStringParameters);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const q = parsed.data;
    const seg = tracer.getSegment()!;
    const sub = seg.addNewSubsegment("listExpenses");

    try {
      const params: any = {
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        Limit: Math.min(q.limit ?? 50, 200),
        ExpressionAttributeValues: { ":pk": `USER#${auth.userId}`, ":prefix": "EXPENSE#" },
        ScanIndexForward: false,
      };

      const filters: string[] = [];
      if (q.status) {
        filters.push("#status = :status");
        params.ExpressionAttributeValues[":status"] = q.status;
        params.ExpressionAttributeNames = { ...params.ExpressionAttributeNames, "#status": "status" };
      }
      if (q.category) {
        filters.push("category = :category");
        params.ExpressionAttributeValues[":category"] = q.category;
      }
      if (q.startDate) {
        filters.push("#date >= :startDate");
        params.ExpressionAttributeValues[":startDate"] = q.startDate;
        params.ExpressionAttributeNames = { ...params.ExpressionAttributeNames, "#date": "date" };
      }
      if (filters.length) params.FilterExpression = filters.join(" AND ");
      if (q.nextToken) {
        params.ExclusiveStartKey = JSON.parse(Buffer.from(q.nextToken, "base64").toString());
      }

      const result = await ddb.send(new QueryCommand(params));
      return ok({
        items: result.Items || [],
        nextToken: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64") : null,
        count: result.Count,
      });
    } finally {
      sub.close();
    }
  }

  // ── GET /expenses/:id ─────────────────────────────────────────────────────
  if (route === "GET /expenses/{id}" && expenseId) {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
    }));
    if (result.Item) return ok(result.Item);
    return err("Expense not found", 404);
  }

  // ── POST /expenses ────────────────────────────────────────────────────────
  if (route === "POST /expenses") {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = createExpenseSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const id = ulid();
    const now = new Date().toISOString();
    const expense: Expense = {
      ...buildExpenseKeys(auth.userId, id, { status: "submitted", category: body.category as any, date: body.date, groupId: body.groupId }),
      entityType: "EXPENSE",
      expenseId: id,
      ownerId: auth.userId,
      merchant: body.merchant.trim().slice(0, 200),
      amount: body.amount,
      currency: body.currency,
      amountUSD: body.amount,
      category: body.category as any,
      date: body.date,
      description: body.description,
      tags: body.tags ?? [],
      status: "submitted",
      splitMethod: body.splitMethod,
      groupId: body.groupId,
      entityContext: body.groupId ? "GROUP" : "PERSONAL",
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: expense, ConditionExpression: "attribute_not_exists(pk)" }));
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") return err("Expense already exists", 409);
      throw e;
    }
    return ok(expense, 201);
  }

  // ── PATCH /expenses/:id ───────────────────────────────────────────────────
  if (route === "PATCH /expenses/{id}" && expenseId) {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = updateExpenseSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const now = new Date().toISOString();

    const groupId = body.groupId ?? event.queryStringParameters?.groupId;
    const pk = groupId ? `GROUP#${groupId}` : `USER#${auth.userId}`;

    const currentRes = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk, sk: `EXPENSE#${expenseId}` },
    }));
    const currentItem = currentRes?.Item;

    if (!currentItem) return err("Expense not found", 404);

    const updates: string[] = [];
    const names: Record<string, string> = {};
    const vals: Record<string, unknown> = { ":updatedAt": now };

    if (body.merchant !== undefined) { updates.push("#merchant = :merchant"); names["#merchant"] = "merchant"; vals[":merchant"] = body.merchant; }
    if (body.category !== undefined) { updates.push("#category = :category"); names["#category"] = "category"; vals[":category"] = body.category; }
    if (body.status !== undefined) { updates.push("#status = :status"); names["#status"] = "status"; vals[":status"] = body.status; }
    
    if (body.status === "approved") {
      updates.push("approvedAt = :approvedAt", "approverId = :approverId");
      vals[":approvedAt"] = now;
      vals[":approverId"] = auth.userId;
    }
    updates.push("updatedAt = :updatedAt");

    try {
      const result = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: currentItem.pk, sk: currentItem.sk },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: vals,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ReturnValues: "ALL_NEW",
        ConditionExpression: "attribute_exists(pk)",
      }));

      return ok({ ...currentItem, ...result.Attributes });
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") return err("Expense not found", 409);
      throw e;
    }
  }

  // ── DELETE /expenses/:id ──────────────────────────────────────────────────
  if (route === "DELETE /expenses/{id}" && expenseId) {
    try {
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
        ConditionExpression: "attribute_exists(pk) AND ownerId = :uid",
        ExpressionAttributeValues: { ":uid": auth.userId },
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }));
      return ok({ deleted: true });
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") {
        if (e.Item) return err("Not authorized to delete this expense", 403);
        return err("Expense not found", 404);
      }
      throw e;
    }
  }

  return err("Route not found", 404);
}));
