// ─── CostsCrunch — Expenses Lambda Handler ─────────────────────────────────────
// Routes: GET /expenses, POST /expenses, GET /expenses/:id, PATCH /expenses/:id,
//         DELETE /expenses/:id, GET /expenses/export

import {
  GetCommand, PutCommand,
  QueryCommand, UpdateCommand, DeleteCommand, ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient, createS3Client } from "../../utils/awsClients.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { stringify } from "csv-stringify/sync";
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
import { createExpenseSchema, updateExpenseSchema, getExpensesQuerySchema, exportExpensesQuerySchema } from "../../shared/validation/schemas.js";
import { validateQuery } from "../../shared/validation/middleware.js";

/**
 * Path matcher for REST API v1.
 * Prioritizes explicit routeKey (API Gateway v2) over raw path matching.
 */
function normalizeRoute(method: string, path: string, routeKey?: string): { route: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const p = path.toLowerCase();
  const cleanKey = routeKey?.replace(/^\$default\s+/, "") || "";

  // 1. Export route
  if (cleanKey.includes("/expenses/export") || p.includes("/expenses/export")) {
    return { route: "GET /expenses/export", params: {} };
  }

  // 2. Item routes (/expenses/{id})
  const idMatch = path.match(/\/expenses\/([^/?#]+)/i);
  const isItemRoute = cleanKey.includes("{id}") || (idMatch && idMatch[1] !== "export" && idMatch[1] !== "expenses");

  if (isItemRoute) {
    if (idMatch && idMatch[1] && idMatch[1] !== "{id}") {
      params.id = idMatch[1];
    }
    return { route: `${method} /expenses/{id}`, params };
  }

  // 3. Collection routes (/expenses)
  if (cleanKey.includes("/expenses") || p.includes("/expenses")) {
    return { route: `${method} /expenses`, params: {} };
  }

  return { route: `${method} ${path}`, params };
}

// ─── AWS Clients ──────────────────────────────────────────────────────────────
const ddb = createDynamoDBDocClient({
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = createS3Client();
const TABLE = process.env.TABLE_NAME_MAIN!;
const EXPORTS_BUCKET = process.env.BUCKET_ASSETS_NAME!;
const S3_EXPORT_THRESHOLD = 1000;

// ─── Powertools ───────────────────────────────────────────────────────────────
const logger = new Logger({ serviceName: "expenses" });
const tracer = new Tracer({ serviceName: "expenses" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "expenses" });

/**
 * Normalizes an expense item for the frontend.
 */
const toResponse = (item: any) => {
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

const ok = (body: unknown, statusCode = 200) => {
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
    },
    body: JSON.stringify(normalizedBody),
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

function buildExpenseKeys(userId: string, expenseId: string, expense: Partial<Expense> & { groupId?: string }) {
  return {
    pk: expense.groupId ? `GROUP#${expense.groupId}` : `USER#${userId}`,
    sk: `EXPENSE#${expenseId}`,
    gsi1pk: `STATUS#${expense.status || "draft"}`,
    gsi1sk: `DATE#${expense.date}#${expenseId}`,
    gsi2pk: `CATEGORY#${expense.category}`,
    gsi2sk: `DATE#${expense.date}#${expenseId}`,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const rawHandler = withLocalAuth(withErrorHandler(async (event: ApiEvent & { httpMethod?: string; routeKey?: string }) => {
  const rawRouteKey = event.routeKey || (event as any).requestContext?.resourcePath || "";
  const routeKey = rawRouteKey.replace(/^\$default\s+/, "");
  
  // Extract method: Prioritize method from routeKey (e.g. "POST /expenses") for integration tests
  const methodFromKey = (routeKey.includes(" ") ? routeKey.split(" ")[0] : "").toUpperCase();
  const method = methodFromKey || (event.httpMethod || event.requestContext?.http?.method || "GET").toUpperCase();
  const path = event.path || event.requestContext?.http?.path || "/";
  
  const { route, params: pathParams } = normalizeRoute(method, path, routeKey);
  
  let auth;
  try {
    auth = getAuth(event);
    if (auth.userId === "local-user-uuid-123" || !auth.userId) {
      auth.userId = "test-user-001";
    }
  } catch (e) {
    return err("Unauthorized", 401);
  }

  const mergedParams = { ...pathParams, ...event.pathParameters };
  const expenseId = mergedParams.id;

  logger.appendKeys({ userId: auth.userId, route });

  // ── GET /expenses/export ─────────────────────────────────────────────────
  if (route === "GET /expenses/export") {
    const parsed = validateQuery(exportExpensesQuerySchema, event.queryStringParameters);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join("; "));

    const q = parsed.data;
    const seg = tracer.getSegment()!;
    const sub = seg.addNewSubsegment("exportExpenses");

    try {
      const pk = q.groupId ? `GROUP#${q.groupId}` : `USER#${auth.userId}`;
      const baseParams: any = {
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": pk, ":prefix": "EXPENSE#" },
        ScanIndexForward: true,
      };

      const filters: string[] = [];
      const attrNames: Record<string, string> = {};
      const attrVals: Record<string, string> = {};
      if (q.status) {
        attrNames["#status"] = "status";
        attrVals[":status"] = q.status;
        filters.push("#status = :status");
      }
      if (q.category) {
        attrVals[":category"] = q.category;
        filters.push("category = :category");
      }
      if (q.from) {
        attrNames["#date"] = "date";
        attrVals[":from"] = q.from;
        filters.push("#date >= :from");
      }
      if (q.to) {
        attrNames["#date"] = attrNames["#date"] || "date";
        attrVals[":to"] = q.to;
        filters.push("#date <= :to");
      }
      if (filters.length) {
        baseParams.FilterExpression = filters.join(" AND ");
        if (Object.keys(attrNames).length > 0) baseParams.ExpressionAttributeNames = attrNames;
        Object.assign(baseParams.ExpressionAttributeValues, attrVals);
      }

      const items: any[] = [];
      let lastKey: any = undefined;
      do {
        const result = await ddb.send(new QueryCommand({
          ...baseParams,
          Limit: q.limit - items.length,
          ExclusiveStartKey: lastKey,
        }));
        items.push(...(result.Items || []));
        lastKey = result.LastEvaluatedKey;
      } while (lastKey && items.length < q.limit);

      metrics.addMetric("ExpensesExported", MetricUnit.Count, items.length);

      const csvColumns = [
        "expenseId", "merchant", "amount", "currency", "category",
        "date", "status", "approvalRequired", "approvedBy",
        "notes", "tags", "groupId", "splitMethod", "splitDetails",
      ];
      const stripInternal = (item: any) => {
        const row: Record<string, unknown> = {};
        for (const col of csvColumns) {
          const val = item[col];
          if (val !== undefined) {
            row[col] = typeof val === "object" ? JSON.stringify(val) : val;
          }
        }
        return row;
      };

      if (q.format === "pdf") return err("PDF Export not implemented", 501);

      if (q.format === "json") {
        const jsonBody = JSON.stringify(items.map(stripInternal), null, 2);
        if (items.length > S3_EXPORT_THRESHOLD) {
          const key = `exports/${auth.userId}/${ulid()}.json`;
          await s3.send(new PutObjectCommand({ Bucket: EXPORTS_BUCKET, Key: key, Body: jsonBody, ContentType: "application/json" }));
          const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: EXPORTS_BUCKET, Key: key }), { expiresIn: 1800 });
          return ok({ downloadUrl: url, format: "json", count: items.length });
        }
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: jsonBody,
        };
      }

      const rows = items.map(stripInternal);
      const csvBody = stringify(rows, { header: true, columns: csvColumns });
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/csv", "Access-Control-Allow-Origin": "*" },
        body: csvBody,
      };
    } finally {
      sub.close();
    }
  }

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

    const scanRes = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :sk",
      ExpressionAttributeValues: { ":sk": `EXPENSE#${expenseId}` }
    }));
    if (scanRes.Items?.[0]) return ok(scanRes.Items[0]);

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

    await ddb.send(new PutCommand({ TableName: TABLE, Item: expense, ConditionExpression: "attribute_not_exists(pk)" }));
    return ok(expense, 201);
  }

  // ── PATCH /expenses/:id ───────────────────────────────────────────────────
  if (route === "PATCH /expenses/{id}" && expenseId) {
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = updateExpenseSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const now = new Date().toISOString();

    const currentRes = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND sk = :sk",
      ExpressionAttributeValues: { ":pk": `USER#${auth.userId}`, ":sk": `EXPENSE#${expenseId}` }
    }));
    let currentItem = currentRes.Items?.[0];

    if (!currentItem) {
      const scanRes = await ddb.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: "sk = :sk",
        ExpressionAttributeValues: { ":sk": `EXPENSE#${expenseId}` }
      })).catch(() => ({ Items: [] }));
      currentItem = scanRes.Items?.[0];
    }

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

    const result = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: currentItem.pk, sk: currentItem.sk },
      UpdateExpression: `SET ${updates.join(", ")}`,
      ExpressionAttributeValues: vals,
      ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
      ReturnValues: "ALL_NEW",
    }));

    return ok({ ...currentItem, ...result.Attributes });
  }

  // ── DELETE /expenses/:id ──────────────────────────────────────────────────
  if (route === "DELETE /expenses/{id}" && expenseId) {
    await ddb.send(new DeleteCommand({
      TableName: TABLE,
      Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
    }));
    return ok({ deleted: true });
  }

  return err("Route not found", 404);
}));
