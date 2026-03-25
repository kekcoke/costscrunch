// ─── CostsCrunch — Expenses Lambda Handler ─────────────────────────────────────
// Routes: GET /expenses, POST /expenses, GET /expenses/:id, PATCH /expenses/:id, DELETE /expenses/:id

import {
  GetCommand, PutCommand,
  QueryCommand, UpdateCommand, DeleteCommand,
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

// ─── AWS Clients ──────────────────────────────────────────────────────────────
const ddb = createDynamoDBDocClient({
  marshallOptions: { removeUndefinedValues: true },
});
const TABLE = process.env.TABLE_NAME_MAIN!;

// ─── Powertools ───────────────────────────────────────────────────────────────
const logger = new Logger({ serviceName: "expenses" });
const tracer = new Tracer({ serviceName: "expenses" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "expenses" });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok = (body: unknown, statusCode = 200) => ({
  statusCode, 
  headers: { 
    "Content-Type": "application/json", 
    "X-Request-Id": ulid(),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
  body: JSON.stringify(body),
});
const err = (msg: string, statusCode = 400) => ({
  statusCode, 
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
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
    const qRaw = event.queryStringParameters || {};
    const parsed = getExpensesQuerySchema.safeParse(qRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const q = parsed.data;
    const seg = tracer.getSegment()!;
    const sub = seg.addNewSubsegment("listExpenses");

    try {
      const params: any = {
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        Limit: Math.min(q.limit ?? 50, 200),
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
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = createExpenseSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const id = ulid();
    const now = new Date().toISOString();
    const expense: Expense = {
      ...buildExpenseKeys(auth.userId, id, { status: "submitted", category: body.category, date: body.date }),
      entityType: "EXPENSE",
      expenseId: id,
      ownerId: auth.userId,
      merchant: body.merchant.trim().slice(0, 200),
      amount: body.amount,
      currency: body.currency,
      amountUSD: body.amount,
      category: body.category,
      date: body.date,
      description: body.description,
      tags: body.tags ?? [],
      status: "submitted",
      splits: body.splits?.map(s => ({ userId: s.userId, amount: s.amount, percentage: s.percentage, shares: s.shares, settled: false })),
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
    const bodyRaw = JSON.parse(event.body || "{}");
    const parsed = updateExpenseSchema.safeParse(bodyRaw);
    if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join('; '));

    const body = parsed.data;
    const now = new Date().toISOString();

    // Build update expression dynamically
    const updates: string[] = [];
    const names: Record<string, string> = {};
    const vals: Record<string, unknown> = { ":updatedAt": now };

    // Map validated fields to DynamoDB updates (only add non-undefined values)
    if (body.merchant !== undefined) { updates.push("#merchant = :merchant"); names["#merchant"] = "merchant"; vals[":merchant"] = body.merchant; }
    if (body.category !== undefined) { updates.push("#category = :category"); names["#category"] = "category"; vals[":category"] = body.category; }
    if (body.date !== undefined) { updates.push("#date = :date"); names["#date"] = "date"; vals[":date"] = body.date; }
    if (body.description !== undefined) { updates.push("#description = :description"); names["#description"] = "description"; vals[":description"] = body.description; }
    if (body.tags !== undefined) { updates.push("#tags = :tags"); names["#tags"] = "tags"; vals[":tags"] = body.tags; }
    if (body.status !== undefined) { updates.push("#status = :status"); names["#status"] = "status"; vals[":status"] = body.status; }
    if (body.approverNote !== undefined) { updates.push("#approverNote = :approverNote"); names["#approverNote"] = "approverNote"; vals[":approverNote"] = body.approverNote; }
    if (body.projectCode !== undefined) { updates.push("#projectCode = :projectCode"); names["#projectCode"] = "projectCode"; vals[":projectCode"] = body.projectCode; }
    if (body.costCenter !== undefined) { updates.push("#costCenter = :costCenter"); names["#costCenter"] = "costCenter"; vals[":costCenter"] = body.costCenter; }
    if (body.reimbursable !== undefined) { updates.push("#reimbursable = :reimbursable"); names["#reimbursable"] = "reimbursable"; vals[":reimbursable"] = body.reimbursable; }
    if (body.billable !== undefined) { updates.push("#billable = :billable"); names["#billable"] = "billable"; vals[":billable"] = body.billable; }

    if (body.status === "approved") {
      updates.push("approvedAt = :approvedAt", "approverId = :approverId");
      vals[":approvedAt"] = now;
      vals[":approverId"] = auth.userId;
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