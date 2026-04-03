import { PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
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
    // Note: $disconnect is best-effort. We scan for the connectionId if we don't have userId
    // But usually we store it such that we can delete by connectionId if we use a GSI
    // Here we'll try to find the item first if possible, or wait for GoneException in notifier
    logger.info("WS Disconnected", { connectionId });
    
    // In a production app, we'd query a GSI (connectionId) to find the userId then delete
    // For now, we'll rely on the notifier's GoneException cleanup to keep it lean
    return { statusCode: 200, body: "Disconnected" };
  }

  return { statusCode: 400, body: "Unknown route" };
};

export const handler = withErrorHandler(rawHandler);
