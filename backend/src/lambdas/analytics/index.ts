// ─── CostsCrunch — Analytics Lambda ────────────────────────────────────────────
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
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
import { analyticsQuerySchema } from "../../shared/validation/schemas.js";

const ddb = createDynamoDBDocClient();
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
  // Support both HTTP API v2 (routeKey) and REST API v1 (path)
  // In LocalStack/REST v1, path may include stage/resource prefix.
  const fullPath = event.path || event.requestContext?.http?.path || "";
  const routeKey = event.routeKey || "";
  const route = routeKey || fullPath;
  
  let auth;
  try {
    auth = getAuth(event);
  } catch (e) {
    return { 
      statusCode: 401, 
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
      },
      body: JSON.stringify({ error: "Unauthorized" }) 
    };
  }

  const rawQ = event.queryStringParameters || {};
  const parsedQ = analyticsQuerySchema.safeParse(rawQ);
  if (!parsedQ.success) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: parsedQ.error.errors.map(e => e.message).join('; ') }),
    };
  }

  const q = parsedQ.data;
  const startDate = q.from || q.startDate || getStartDate(q.period);
  const endDate = q.to || q.endDate || new Date().toISOString().slice(0, 10);

  // Validation: Prevent inverted date ranges
  if (startDate > endDate) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Invalid date range: startDate cannot be ahead of endDate" }),
    };
  }

  let expenses: any[] = [];

  if (q.scope === "personal") {
    const res = await ddb.send(new QueryCommand({
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
    expenses = res.Items || [];
  } else if (q.scope === "group" && q.groupId) {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "#date >= :startDate AND #date <= :endDate",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":pk": `GROUP#${q.groupId}`,
        ":prefix": "EXPENSE#",
        ":startDate": startDate,
        ":endDate": endDate,
      },
    }));
    expenses = res.Items || [];
  } else {
    // scope === 'all' or default
    // In a single-table design, 'all' usually requires querying multiple partitions 
    // or using a GSI if we want everything across users/groups.
    // For now, we aggregate the user's personal expenses and their memberships.
    
    // 1. Get personal
    const personalPromise = ddb.send(new QueryCommand({
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

    // 2. Get memberships to find groups
    const memberRes = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `USER#${auth.userId}`,
        ":prefix": "GROUP_MEMBER#",
      },
    }));

    const groupIds = (memberRes.Items || []).map(m => m.groupId);
    const groupPromises = groupIds.map(gid => ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: "#date >= :startDate AND #date <= :endDate",
      ExpressionAttributeNames: { "#date": "date" },
      ExpressionAttributeValues: {
        ":pk": `GROUP#${gid}`,
        ":prefix": "EXPENSE#",
        ":startDate": startDate,
        ":endDate": endDate,
      },
    })));

    const allResults = await Promise.all([personalPromise, ...groupPromises]);
    expenses = allResults.flatMap(r => r.Items || []);
  }

  // Post-fetch filtering: Categories
  if (q.categories) {
    const catList = q.categories.split(',').filter(Boolean);
    if (catList.length > 0) {
      expenses = expenses.filter(e => catList.includes(e.category));
    }
  } else if (q.category) {
    expenses = expenses.filter(e => e.category === q.category);
  }

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

  if (route.includes("/chart-data")) {
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

  return { 
    statusCode: 404, 
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": "true",
    },
    body: JSON.stringify({ error: "Not found" }) 
  };
}));
