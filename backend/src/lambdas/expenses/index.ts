// ─── CostsCrunch — Expenses Lambda Handler ─────────────────────────────────────
// Routes: GET /expenses, POST /expenses, GET /expenses/:id, PATCH /expenses/:id, DELETE /expenses/:id

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand,
  QueryCommand, UpdateCommand, DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { ulid } from "ulid";
import type {
  ApiEvent, AuthContext, CreateExpenseRequest,
  Expense, GetExpensesQuery,
} from "../../shared/models/types.js";

// ─── AWS Clients ──────────────────────────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME_MAIN!;

// ─── Powertools ───────────────────────────────────────────────────────────────
const logger = new Logger({ serviceName: "expenses" });
const tracer = new Tracer({ serviceName: "expenses" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "expenses" });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok = (body: unknown, statusCode = 200) => ({
  statusCode, headers: { "Content-Type": "application/json", "X-Request-Id": ulid() },
  body: JSON.stringify(body),
});
const err = (msg: string, statusCode = 400) => ({
  statusCode, headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: msg }),
});

function buildExpenseKeys(userId: string, expenseId: string, expense: Partial<Expense>) {
  return {
    pk: `USER#${userId}`,
    sk: `EXPENSE#${expenseId}`,
    gsi1pk: `STATUS#${expense.status || "draft"}`,
    gsi1sk: `DATE#${expense.date}#${expenseId}`,
    gsi2pk: `CATEGORY#${expense.category}`,
    gsi2sk: `DATE#${expense.date}#${expenseId}`,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const rawHandler = withLocalAuth(withErrorHandler(async (event: ApiEvent & { httpMethod?: string; routeKey?: string }) => {
  const route = event.routeKey || `${event.httpMethod} ${Object.keys(event.pathParameters || {}).length ? "/{id}" : ""}`;
  
  let auth;
  try {
    auth = getAuth(event);
  } catch (e) {
    return err("Unauthorized", 401);
  }

  const expenseId = event.pathParameters?.id;

  logger.appendKeys({ userId: auth.userId, route });

  // ── GET /expenses ─────────────────────────────────────────────────────────
  if (route.startsWith("GET") && !expenseId) {
    const q = (event.queryStringParameters || {}) as GetExpensesQuery;
    const seg = tracer.getSegment()!;
    const sub = seg.addNewSubsegment("listExpenses");

    try {
      const params: any = {
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${auth.userId}`,
          ":prefix": "EXPENSE#",
        },
        Limit: Math.min(Number(q.limit) || 50, 200),
        ScanIndexForward: false,
      };

      // Optional filters
      const filters: string[] = [];
      if (q.status) {
        filters.push("#status = :status");
        params.ExpressionAttributeValues[":status"] = q.status;
        
        // Initialize or add to ExpressionAttributeNames
        params.ExpressionAttributeNames = { 
          ...params.ExpressionAttributeNames, 
          "#status": "status" 
        };
      }
      if (q.category) {
        filters.push("category = :category");
        params.ExpressionAttributeValues[":category"] = q.category;
      }
      if (q.startDate) {
        filters.push("#date >= :startDate");
        params.ExpressionAttributeValues[":startDate"] = q.startDate;
        params.ExpressionAttributeNames = { "#date": "date" };
      }
      if (filters.length) params.FilterExpression = filters.join(" AND ");
      if (q.nextToken) {
        params.ExclusiveStartKey = JSON.parse(Buffer.from(q.nextToken, "base64").toString());
      }

      const result = await ddb.send(new QueryCommand(params));
      metrics.addMetric("ExpensesListed", MetricUnit.Count, result.Items?.length || 0);

      return ok({
        items: result.Items || [],
        nextToken: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
          : null,
        count: result.Count,
      });
    } finally {
      sub.close();
    }
  }

  // ── GET /expenses/:id ─────────────────────────────────────────────────────
  if (route.startsWith("GET") && expenseId) {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
    }));
    if (!result.Item) return err("Expense not found", 404);
    return ok(result.Item);
  }

  // ── POST /expenses ────────────────────────────────────────────────────────
  if (route.startsWith("POST")) {
    const body: CreateExpenseRequest = JSON.parse(event.body || "{}");

    // Validation
    if (!body.merchant || !body.amount || !body.currency || !body.date) {
      return err("merchant, amount, currency, date are required");
    }
    if (body.amount <= 0 || body.amount > 1_000_000) {
      return err("amount must be between 0 and 1,000,000");
    }

    const id = ulid();
    const now = new Date().toISOString();
    const expense: Expense = {
      ...buildExpenseKeys(auth.userId, id, { status: "submitted", ...body }),
      entityType: "EXPENSE",
      expenseId: id,
      ownerId: auth.userId,
      merchant: body.merchant.trim().slice(0, 200),
      amount: body.amount,
      currency: body.currency,
      amountUSD: body.amount, // TODO: call FX rate service for non-USD
      category: body.category || "Other",
      date: body.date,
      description: body.description,
      tags: body.tags || [],
      status: "submitted",
      splits: body.splits?.map(s => ({ ...s, settled: false })),
      splitMethod: body.splitMethod,
      groupId: body.groupId,
      entityContext: body.groupId ? "GROUP" : "PERSONAL",
      projectCode: body.projectCode,
      costCenter: body.costCenter,
      billable: body.billable,
      reimbursable: body.reimbursable,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await ddb.send(new PutCommand({
        TableName: TABLE,
        Item: expense,
        ConditionExpression: "attribute_not_exists(pk)",
      }));
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") {
        return err("Expense already exists", 409);
      }
      throw e;
    }

    metrics.addMetric("ExpenseCreated", MetricUnit.Count, 1);
    metrics.addMetric("ExpenseAmount", MetricUnit.NoUnit, body.amount);
    logger.info("Expense created", { expenseId: id, amount: body.amount });

    return ok(expense, 201);
  }

  // ── PATCH /expenses/:id ───────────────────────────────────────────────────
  if (route.startsWith("PATCH") && expenseId) {
    const body = JSON.parse(event.body || "{}");
    const now = new Date().toISOString();

    // Build update expression dynamically
    const updates: string[] = [];
    const names: Record<string, string> = {};
    const vals: Record<string, unknown> = { ":updatedAt": now };

    const allowed = ["merchant", "amount", "currency", "category", "date", "description", "tags", "status", "approverNote", "projectCode", "costCenter"];
    for (const key of allowed) {
      if (body[key] !== undefined) {
        // ALWAYS use placeholders to avoid reserved word conflicts
        updates.push(`#${key} = :${key}`);
        names[`#${key}`] = key;
        vals[`:${key}`] = body[key];
      }
    }

    if (body.status === "approved") {
      updates.push("approvedAt = :approvedAt");
      vals[":approvedAt"] = now;
      vals[":approverId"] = auth.userId;
      updates.push("approverId = :approverId");
    }

    updates.push("updatedAt = :updatedAt");

    let result;
    try {
      result = await ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
        UpdateExpression: `SET ${updates.join(", ")}`,
        ExpressionAttributeValues: vals,
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ConditionExpression: "attribute_exists(pk)",
        ReturnValues: "ALL_NEW",
      }));
    } catch (e: any) {
      if (e.name === "ConditionalCheckFailedException") {
        return err("Expense not found", 409);
      }
      throw e;
    }

    metrics.addMetric("ExpenseUpdated", MetricUnit.Count, 1);
    return ok(result.Attributes);
  }

  // ── DELETE /expenses/:id ──────────────────────────────────────────────────
  if (route.startsWith("DELETE") && expenseId) {
    try {
      await ddb.send(new DeleteCommand({
        TableName: TABLE,
        Key: { pk: `USER#${auth.userId}`, sk: `EXPENSE#${expenseId}` },
        ConditionExpression: "ownerId = :uid",
        ExpressionAttributeValues: { ":uid": auth.userId },
      }));

      metrics.addMetric("ExpenseDeleted", MetricUnit.Count, 1);
      return ok({ deleted: true });
  
    } catch (e: any)
    {
      if (e.name === "ConditionalCheckFailedException") {
        // Check if it's because it doesn't exist or wrong owner
        return ok({ deleted: true, note: "item not found or already deleted" });
      }
      throw e;
    }
  }

  return err("Route not found", 404);
}));