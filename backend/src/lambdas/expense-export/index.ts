// ─── CostsCrunch — Expense Export Lambda ──────────────────────────────────────
// GET /expense-export — Exports expenses as CSV, uploads to S3, returns presigned URL

import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient, createS3Client } from "../../utils/awsClients.js";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { stringify } from "csv-stringify/sync";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { ulid } from "ulid";
import type { ApiEvent } from "../../shared/models/types.js";
import { exportExpensesQuerySchema } from "../../shared/validation/schemas.js";
import { validateQuery } from "../../shared/validation/middleware.js";

const ddb = createDynamoDBDocClient({ marshallOptions: { removeUndefinedValues: true } });
const s3 = createS3Client();
const TABLE = process.env.TABLE_NAME_MAIN!;
const EXPORTS_BUCKET = process.env.BUCKET_ASSETS_NAME!;
const S3_UPLOAD_THRESHOLD = 1000; // items above this count go to S3

const logger = new Logger({ serviceName: "expense-export" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "expense-export" });

const ok = (body: unknown, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  },
  body: JSON.stringify(body),
});

const err = (msg: string, statusCode = 400) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify({ error: msg }),
});

const CSV_COLUMNS = [
  "expenseId", "merchant", "amount", "currency", "category",
  "date", "status", "approvalRequired", "approvedBy",
  "notes", "tags", "groupId", "splitMethod", "splitDetails",
];

function stripInternal(item: any) {
  const row: Record<string, unknown> = {};
  for (const col of CSV_COLUMNS) {
    const val = item[col];
    if (val !== undefined) {
      row[col] = typeof val === "object" ? JSON.stringify(val) : val;
    }
  }
  return row;
}

export const rawHandler = withLocalAuth(withErrorHandler(async (event: ApiEvent) => {
  let auth;
  try {
    auth = getAuth(event);
    if (!auth.userId || auth.userId === "local-user-uuid-123") {
      auth.userId = "test-user-001"; // local dev fallback
    }
  } catch (e) {
    return err("Unauthorized", 401);
  }

  const method = event.httpMethod || event.requestContext?.http?.method || "GET";
  const path = event.path || event.requestContext?.http?.path || "/";
  const routeKey = (event.routeKey || "").replace(/^\$default\s+/, "");

  // Route: GET /expense-export
  const isExportRoute =
    routeKey.includes("/expense-export") ||
    path.includes("/expense-export") ||
    (method === "GET" && path.match(/^\/expense-export/));

  if (!isExportRoute) {
    return err("Not found", 404);
  }

  const parsed = validateQuery(exportExpensesQuerySchema, event.queryStringParameters);
  if (!parsed.success) return err(parsed.error.errors.map(e => e.message).join("; "));

  const q = parsed.data;
  logger.appendKeys({ userId: auth.userId, format: q.format || "csv" });

  // Build query
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
    attrNames["#date"] = attrNames["#date"] || "date";
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

  // Paginate through all matching items
  const items: any[] = [];
  let lastKey: any = undefined;
  do {
    const result = await ddb.send(new QueryCommand({
      ...baseParams,
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(result.Items || []));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  metrics.addMetric("ExpenseExportRequested", MetricUnit.Count, 1);
  metrics.addMetric("ExpenseExportCount", MetricUnit.Count, items.length);

  const filename = `expenses-${q.from || "all"}-${q.to || "all"}`;
  const useS3 = items.length >= S3_UPLOAD_THRESHOLD;

  if (q.format === "json") {
    const jsonBody = JSON.stringify(items.map(stripInternal), null, 2);
    if (useS3) {
      const key = `exports/${auth.userId}/${ulid()}.json`;
      await s3.send(new PutObjectCommand({
        Bucket: EXPORTS_BUCKET,
        Key: key,
        Body: jsonBody,
        ContentType: "application/json",
      }));
      const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: EXPORTS_BUCKET, Key: key }), { expiresIn: 1800 });
      logger.info("Exported to S3 (JSON)", { key, count: items.length });
      return ok({ downloadUrl, format: "json", count: items.length, expiresIn: 1800 });
    }
    return ok({ data: jsonBody, format: "json", count: items.length }, 200);
  }

  // CSV (default)
  const rows = items.map(stripInternal);
  const csvBody = stringify(rows, { header: true, columns: CSV_COLUMNS });

  if (useS3) {
    const key = `exports/${auth.userId}/${ulid()}.csv`;
    await s3.send(new PutObjectCommand({
      Bucket: EXPORTS_BUCKET,
      Key: key,
      Body: csvBody,
      ContentType: "text/csv",
    }));
    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: EXPORTS_BUCKET, Key: key }), { expiresIn: 1800 });
    logger.info("Exported to S3 (CSV)", { key, count: items.length });
    return ok({ downloadUrl, format: "csv", count: items.length, expiresIn: 1800 });
  }

  logger.info("Exported inline (CSV)", { count: items.length });
  return ok({ data: csvBody, format: "csv", count: items.length }, 200);
}));

export const handler = rawHandler;
