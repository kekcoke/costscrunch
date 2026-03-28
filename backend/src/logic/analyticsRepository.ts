import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../utils/awsClients.js";

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
  async getExpenses(params: QueryParams) {
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

    let expenses: any[] = [];
    const scanForward = sortOrder === "asc";

    if (scope === "personal") {
      expenses = await this.queryPartition(`USER#${userId}`, filterExpr, exprNames, exprValues, scanForward);
    } else if (scope === "group" && groupId) {
      expenses = await this.queryPartition(`GROUP#${groupId}`, filterExpr, exprNames, exprValues, scanForward);
    } else {
      // scope === 'all'
      const personalPromise = this.queryPartition(`USER#${userId}`, filterExpr, exprNames, exprValues, scanForward);
      
      const memberRes = await ddb.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": `USER#${userId}`,
          ":prefix": "GROUP_MEMBER#",
        },
      }));

      const groupIds = (memberRes.Items || []).map(m => m.groupId);
      const groupPromises = groupIds.map(gid => 
        this.queryPartition(`GROUP#${gid}`, filterExpr, exprNames, exprValues, scanForward)
      );

      const allResults = await Promise.all([personalPromise, ...groupPromises]);
      expenses = allResults.flat();
      
      // Manual sort for multi-partition results
      expenses.sort((a, b) => {
        const valA = a[sortBy];
        const valB = b[sortBy];
        if (typeof valA === "string" && typeof valB === "string") {
          return sortOrder === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortOrder === "asc" ? (valA - valB) : (valB - valA);
      });
    }

    return expenses;
  }

  private async queryPartition(pk: string, filterExpr: string, exprNames: Record<string, string>, exprValues: Record<string, any>, scanForward: boolean) {
    const res = await ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      FilterExpression: filterExpr,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: { ":pk": pk, ":prefix": "EXPENSE#", ...exprValues },
      ScanIndexForward: scanForward,
    }));
    return res.Items || [];
  }
}

export const analyticsRepo = new AnalyticsRepository();
