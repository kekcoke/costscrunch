import { PutCommand, DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import { getAuth } from "../../utils/auth.js";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "ws-handler" });

export const rawHandler = async (event: any) => {
  const { routeKey, connectionId } = event.requestContext;
  
  if (routeKey === "$connect") {
    let auth;
    try {
      // In a real scenario, the token might be in a query param or header
      // For API Gateway WebSocket, we often use a custom authorizer or validate a token passed in query string
      auth = getAuth(event);
    } catch (e) {
      logger.warn("WS Connection unauthorized", { error: e });
      // Depending on APIGW configuration, returning 401 here might work if it's a custom authorizer
      // For simplicity in this proxy setup, we'll allow if MOCK_AUTH is set or try to proceed
      if (process.env.MOCK_AUTH !== "true") {
        return { statusCode: 401, body: "Unauthorized" };
      }
      auth = { userId: event.queryStringParameters?.userId || "local-user" };
    }

    const userId = auth.userId;
    logger.info("WS Connected", { userId, connectionId });

    const ddb = createDynamoDBDocClient();
    await ddb.send(new PutCommand({
      TableName: process.env.TABLE_NAME_CONNECTIONS!,
      Item: {
        pk: `WS_CONN#${userId}`,
        sk: `CONN#${connectionId}`,
        connectionId,
        userId,
        connectedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (8 * 60 * 60) // 8 hours
      }
    }));

    return { statusCode: 200, body: "Connected" };
  }

  if (routeKey === "$disconnect") {
    logger.info("WS Disconnected", { connectionId });

    const ddb = createDynamoDBDocClient();
    const CONN_TABLE = process.env.TABLE_NAME_CONNECTIONS!;

    // Scan for the connection record by connectionId attribute.
    // NOTE: A GSI on connectionId (IaC-011) should replace this scan in production
    // to make the lookup O(1) rather than O(N).
    const found = await ddb.send(new ScanCommand({
      TableName: CONN_TABLE,
      FilterExpression: "connectionId = :cid",
      ExpressionAttributeValues: { ":cid": connectionId },
      ProjectionExpression: "pk, sk",
      Limit: 1,
    }));

    const item = found.Items?.[0];
    if (item) {
      await ddb.send(new DeleteCommand({
        TableName: CONN_TABLE,
        Key: { pk: item.pk, sk: item.sk },
      }));
      logger.info("WS connection record deleted", { connectionId });
    } else {
      logger.warn("WS disconnect: no connection record found", { connectionId });
    }

    return { statusCode: 200, body: "Disconnected" };
  }

  return { statusCode: 400, body: "Unknown route" };
};

export const handler = withErrorHandler(rawHandler);
