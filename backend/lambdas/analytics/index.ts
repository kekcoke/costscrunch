// ─── Costscrunch — Analytics Lambda ────────────────────────────────────────────
// Routes: GET /analytics/summary, GET /analytics/trends

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import type { ApiEvent } from "../shared/models/types";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME!;
const logger = new Logger({ serviceName: "analytics" });
const metrics = new Metrics({ namespace: "Costscrunch" });

const ok = (body: unknown) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const handler = async (event: ApiEvent & { routeKey?: string }) => {
  const route = event.routeKey || "";
  const auth = { userId: event.requestContext.authorizer.jwt.claims.sub };
  const q = event.queryStringParameters || {};

  if (route.startsWith("GET") && route.includes("summary")) {
    const period = q.period || "month"; // month | quarter | year
    const now = new Date();
    const startDate = period === "month"
      ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`
      : period === "quarter"
        ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10)
        : `${now.getFullYear()}-01-01`;

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "#date >= :startDate",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":pk": `USER#${auth.userId}`,
        ":prefix": "EXPENSE#",
        ":startDate": startDate,
      },
    }));

    const expenses = result.Items || [];
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let total = 0;

    for (const e of expenses) {
      total += e.amountUSD || e.amount || 0;
      byCategory[e.category] = (byCategory[e.category] || 0) + (e.amountUSD || e.amount || 0);
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      const month = (e.date || "").slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + (e.amountUSD || e.amount || 0);
    }

    const topCategories = Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }));

    metrics.addMetric("SummaryGenerated", MetricUnit.Count, 1);
    return ok({
      period, startDate, totalAmount: Math.round(total * 100) / 100,
      expenseCount: expenses.length,
      byCategory: topCategories,
      byStatus,
      byMonth,
      averageExpense: expenses.length ? Math.round((total / expenses.length) * 100) / 100 : 0,
    });
  }

  if (route.startsWith("GET") && route.includes("trends")) {
    // Last 6 months trend
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "#date >= :startDate",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":pk": `USER#${auth.userId}`,
        ":prefix": "EXPENSE#",
        ":startDate": months[0] + "-01",
      },
    }));

    const byMonth: Record<string, { total: number; count: number }> = {};
    for (const m of months) byMonth[m] = { total: 0, count: 0 };

    for (const e of result.Items || []) {
      const month = (e.date || "").slice(0, 7);
      if (byMonth[month]) {
        byMonth[month].total += e.amountUSD || e.amount || 0;
        byMonth[month].count += 1;
      }
    }

    const trend = months.map(m => ({
      month: m,
      total: Math.round(byMonth[m].total * 100) / 100,
      count: byMonth[m].count,
    }));

    return ok({ trend });
  }

  return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
};