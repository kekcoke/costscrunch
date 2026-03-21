// ─── CostsCrunch — Analytics Lambda ────────────────────────────────────────────
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import type { ApiEvent } from "../../shared/models/types.js";
import type { 
  AnalyticsQuery, 
  ExpenseSummaryStats, 
  AnalyticsTrends, 
  AnalyticsChartData, BubbleChartDatum 
} from "./../../shared/models/charts.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME_MAIN!;
const logger = new Logger({ serviceName: "analytics" });
const metrics = new Metrics({ namespace: "CostsCrunch" });

const ok = (body: unknown) => ({ 
  statusCode: 200, 
  headers: { 
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Credentials": "true",
  }, 
  body: JSON.stringify(body) 
});

const getStartDate = (period: string = "month"): string => {
  const now = new Date();
  if (period === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  
  else if (period === "quarter") 
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10);
  
  else if (period === "year") 
    return `${now.getFullYear()}-01-01`;

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};

export const handler = withLocalAuth(withErrorHandler(async (event: ApiEvent & { routeKey?: string }) => {
  const route = event.routeKey || "";
  
  let auth;
  try {
    auth = getAuth(event);
  } catch (e) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  const q = (event.queryStringParameters || {}) as AnalyticsQuery;

  const startDate = q.from || getStartDate(q.period);
  const endDate = q.to || new Date().toISOString().slice(0, 10);

  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    FilterExpression: "#date >= :startDate AND #date <= :endDate",
    ExpressionAttributeNames: { "#date": "date" },
    ExpressionAttributeValues: {
      ":pk": `USER#${auth.userId}`,
      ":prefix": "EXPENSE#",
      ":startDate": startDate,
      ":endDate": endDate,
    },
  }));

  const expenses = result.Items || [];

  if (route.includes("/summary")) {
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let total = 0;

    for (const e of expenses) {
      const amount = e.amountUSD || e.amount || 0;
      total += amount;
      byCategory[e.category] = (byCategory[e.category] || 0) + amount;
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      const month = (e.date || "").slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + amount;
    }

    const sortedCats = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
    
    const stats: ExpenseSummaryStats = {
      period: q.period || "custom",
      startDate,
      totalAmount: Math.round(total * 100) / 100,
      expenseCount: expenses.length,
      byCategory: sortedCats.slice(0, 8).map(
        ([category, amount]) => 
          ({ category, amount: Math.round(amount * 100) / 100 })),
      byStatus,
      byMonth,
      averageExpense: expenses.length ? Math.round((total / expenses.length) * 100) / 100 : 0,
      topCategory: sortedCats[0]?.[0],
    };

    metrics.addMetric("SummaryGenerated", MetricUnit.Count, 1);
    return ok(stats);
  }

  if (route.includes("/trends")) {
    const months: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const byMonth: Record<string, { total: number; count: number }> = {};
    months.forEach(m => byMonth[m] = { total: 0, count: 0 });

    expenses.forEach(e => {
      const month = (e.date || "").slice(0, 7);
      if (byMonth[month]) {
        byMonth[month].total += e.amountUSD || e.amount || 0;
        byMonth[month].count += 1;
      }
    });

    const trends: AnalyticsTrends = {
      trend: months.map(m => ({
        label: m,
        total: Math.round(byMonth[m].total * 100) / 100,
        count: byMonth[m].count,
      }))
    };

    return ok(trends);
  }

  if (route.includes("/chartData")) {
    const categoryTotals: Record<string, number> = {};
    const bubbleMap: Record<string, BubbleChartDatum> = {};

    expenses.forEach(e => {
      const amount = e.amountUSD || e.amount || 0;
      categoryTotals[e.category] = (categoryTotals[e.category] || 0) + amount;
      
      const key = `${e.date}-${e.category}`;
      if (!bubbleMap[key]) {
        bubbleMap[key] = { date: e.date, category: e.category, amount: 0, frequency: 0 };
      }
      bubbleMap[key].amount += amount;
      bubbleMap[key].frequency += 1;
    });

    const chartData: AnalyticsChartData = {
      donut: Object.entries(categoryTotals).map(([label, value]) => ({
        label, value: Math.round(value * 100) / 100, color: "#000000" // Placeholder color
      })),
      horizontalBar: Object.entries(categoryTotals).map(([category, amount]) => ({
        category, amount: Math.round(amount * 100) / 100
      })),
      bubble: Object.values(bubbleMap),
      stackedBar: [], // Implementation depends on specific requirements
    };

    return ok(chartData);
  }

  return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
}));
