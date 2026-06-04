import { QueryCommand, BatchGetCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../utils/awsClients.js";
import type { Expense } from "../shared/models/types.js";
import { ExpenseSchema } from "../shared/validation/schemas.js";

const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;

export interface QueryParams {
  userId: string;
  scope: "personal" | "group" | "all";
  groupId?: string;
  startDate: string;
  endDate: string;
  categories?: string[];
  category?: string;
  sortBy?: "date" | "amount";
  sortOrder?: "asc" | "desc";
}

export class AnalyticsRepository {
  async getExpenses(params: QueryParams): Promise<Expense[]> {
    const { scope, userId, groupId, startDate, endDate, categories, category, sortBy = "date", sortOrder = "asc" } = params;

    const catList = categories || [];
    let filterExpr = "#date >= :startDate AND #date <= :endDate";
    const exprNames: Record<string, string> = { "#date": "date" };
    const exprValues: Record<string, any> = { 
      ":startDate": startDate, 
      ":endDate": endDate 
    };

    if (catList.length > 0) {
      const categoryFilters = catList.map((_, i) => `:cat${i}`);
      filterExpr += ` AND category IN (${categoryFilters.join(', ')})`;
      catList.forEach((cat, i) => {
        exprValues[`:cat${i}`] = cat;
      });
    } else if (category) {
      filterExpr += " AND category = :category";
      exprValues[":category"] = category;
    }

    let expenses: Expense[] = [];
    const scanForward = sortOrder === "asc";

    if (scope === "personal") {
      expenses = await this.queryPartition(`USER#${userId}`, filterExpr, exprNames, exprValues, scanForward);
    } else if (scope === "group" && groupId) {
      expenses = await this.queryPartition(`GROUP#${groupId}`, filterExpr, exprNames, exprValues, scanForward);
    } else {
      // scope === 'all': personal via queryPartition + group analytics via BatchGetItem
      const personalExpenses = await this.queryPartition(`USER#${userId}`, filterExpr, exprNames, exprValues, scanForward);

      const memberRes = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "ACTIVE_GROUP_MEMBER#",
        },
      }));

      const groupIds = (memberRes.Items || []).map(m => m.groupId as string);
      const period = `${startDate}:${endDate}`;
      const groupExpenses: any[] = [];

      if (groupIds.length > 0) {
        let pendingKeys = groupIds.map(gid => ({ pk: `GROUP#${gid}`, sk: `ANALYTICS#${period}` }));
        while (pendingKeys.length > 0) {
          const batch = pendingKeys.splice(0, 100);
          const batchRes = await ddb.send(new BatchGetCommand({
            RequestItems: { [TABLE]: { Keys: batch } },
          }));
          groupExpenses.push(...(batchRes.Responses?.[TABLE] ?? []));
          const unprocessed = batchRes.UnprocessedKeys?.[TABLE]?.Keys;
          pendingKeys = unprocessed ? (unprocessed as typeof batch) : [];
        }
      }

      expenses = [...personalExpenses, ...groupExpenses];

      // Manual sort for multi-partition results
      expenses.sort((a, b) => {
        const valA = a[sortBy];
        const valB = b[sortBy];
        if (typeof valA === "string" && typeof valB === "string") {
          return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortOrder === "asc" ? ((valA as number) - (valB as number)) : ((valB as number) - (valA as number));
      });
    }

    return expenses;
  }

  private async queryPartition(pk: string, filterExpr: string, exprNames: Record<string, string>, exprValues: Record<string, any>, scanForward: boolean): Promise<Expense[]> {
    const items: Expense[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const res = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        FilterExpression: filterExpr,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: { ":pk": pk, ":prefix": "EXPENSE#", ...exprValues },
        ScanIndexForward: scanForward,
        ExclusiveStartKey: lastKey,
      }));
      items.push(...(res.Items || []).map(item => ExpenseSchema.parse(item) as unknown as Expense));
      lastKey = res.LastEvaluatedKey;
    } while (lastKey);
    return items;
  }
}

export const analyticsRepo = new AnalyticsRepository();
