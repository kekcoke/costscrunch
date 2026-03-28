import { UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { withLocalAuth } from "../_local/mockAuth.js";
import { updateProfileSchema } from "../../shared/validation/schemas.js";
import type { ApiEvent } from "../../shared/models/types.js";

const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;
const logger = new Logger({ serviceName: "profile" });
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

export const handler = withLocalAuth(withErrorHandler(async (event: ApiEvent) => {
  const auth = getAuth(event);
  const method = event.httpMethod || event.requestContext?.http?.method || "";

  // GET /profile - Fetch current profile
  if (method === "GET") {
    const res = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `USER#${auth.userId}`, sk: `PROFILE#${auth.userId}` }
    }));

    if (!res.Item) {
      return { statusCode: 404, body: JSON.stringify({ error: "Profile not found" }) };
    }

    return ok(res.Item);
  }

  // PATCH /profile - Update profile
  if (method === "PATCH") {
    const body = JSON.parse(event.body || "{}");
    const parsed = updateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: parsed.error.errors.map(e => e.message).join("; ") })
      };
    }

    const updates = parsed.data;
    const now = new Date().toISOString();

    let updateExpression = "SET updatedAt = :now";
    const expressionNames: Record<string, string> = { "#updatedAt": "updatedAt" };
    const expressionValues: Record<string, any> = { ":now": now };

    // Dynamically build update expression
    Object.entries(updates).forEach(([key, value]) => {
      if (value !== undefined) {
        updateExpression += `, #${key} = :${key}`;
        expressionNames[`#${key}`] = key;
        expressionValues[`:${key}`] = value;
      }
    });

    const res = await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `USER#${auth.userId}`, sk: `PROFILE#${auth.userId}` },
      UpdateExpression: updateExpression.replace("updatedAt =", "#updatedAt ="),
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: "ALL_NEW",
    }));

    metrics.addMetric("ProfileUpdated", MetricUnit.Count, 1);
    return ok(res.Attributes);
  }

  return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
}));
