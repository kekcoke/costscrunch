// ─── CostsCrunch — WebSocket Notifier Lambda ─────────────────────────────────
// Triggered by: EventBridge rule matching { "detail-type": ["ReceiptScanCompleted"] }
// Responsibility: look up the user's active WebSocket connection ID in DynamoDB,
//                 then push the scan result directly to the browser via the
//                 API Gateway @connections endpoint.
//
// Pipeline position: EventBridge → [this file] → API Gateway WebSocket → browser
//
// DynamoDB connection table shape:
//   pk: "WS_CONN#{userId}"   sk: "CONN#{connectionId}"
//   connectionId, userId, connectedAt, ttl

import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from "@aws-sdk/client-apigatewaymanagementapi";
import {
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import type { EventBridgeEvent } from "aws-lambda";

// ─── Clients ──────────────────────────────────────────────────────────────────
const ddb = createDynamoDBDocClient();

// The WebSocket endpoint is known at deploy time via an env var.
// Format: https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
const wsClient = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_ENDPOINT!,
});

const CONN_TABLE = process.env.TABLE_NAME_CONNECTIONS!; // separate from the main table

const logger  = new Logger({ serviceName: "receipts-ws-notifier" });
const metrics = new Metrics({ namespace: "CostsCrunch", serviceName: "receipts-ws-notifier" });

// ─── EventBridge detail shape (mirrors what sns-webhook.ts emits) ─────────────
interface ReceiptScanCompletedDetail {
  userId:       string;
  expenseId:    string;
  scanId:       string;
  merchant?:    string | number;
  amount?:      number;
  category:     string;
  confidence:   number;
  processingMs: number;
}

// ─── Section 1: Connection lookup ────────────────────────────────────────────
// Query all active connections for a given userId.
// A user may have multiple tabs open — we fan-out to all of them.

async function getConnectionIds(userId: string): Promise<string[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName:              CONN_TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `WS_CONN#${userId}` },
      ProjectionExpression:   "connectionId",
    })
  );
  return (result.Items ?? []).map(i => i.connectionId as string);
}

// ─── Section 2: Stale connection cleanup ─────────────────────────────────────
// API Gateway returns GoneException when a connectionId is no longer valid
// (browser closed the tab, network dropped, etc.). We prune it immediately
// so we don't keep attempting dead connections on future scans.

async function deleteStaleConnection(userId: string, connectionId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: CONN_TABLE,
      Key: {
        pk: `WS_CONN#${userId}`,
        sk: `CONN#${connectionId}`,
      },
    })
  );
  logger.info("Pruned stale WebSocket connection", { connectionId });
}

// ─── Section 3: Push to one connection ────────────────────────────────────────

async function pushToConnection(
  userId:       string,
  connectionId: string,
  payload:      object
): Promise<"sent" | "stale"> {
  try {
    await wsClient.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data:         Buffer.from(JSON.stringify(payload)),
      })
    );
    return "sent";
  } catch (e) {
    if (e instanceof GoneException) {
      await deleteStaleConnection(userId, connectionId);
      return "stale";
    }
    throw e; // unexpected — let Lambda retry
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withErrorHandler(async (
  event: EventBridgeEvent<"ReceiptScanCompleted", ReceiptScanCompletedDetail>
): Promise<void> => {
  const detail = event.detail;
  const { userId, expenseId, scanId } = detail;

  logger.appendKeys({ userId, expenseId, scanId });
  logger.info("Pushing scan result to WebSocket connections");

  // ── Step 1: Find all active connections for this user ─────────────────────
  const connectionIds = await getConnectionIds(userId);

  if (connectionIds.length === 0) {
    // User has no open WebSocket — not an error (they may have navigated away).
    // The frontend can fall back to reading DynamoDB on next page load.
    logger.info("No active WebSocket connections for user");
    metrics.addMetric("WsNoConnection", MetricUnit.Count, 1);
    return;
  }

  // ── Step 2: Fan-out push to every open tab ────────────────────────────────
  const wsPayload = {
    type:         "RECEIPT_SCAN_COMPLETED",
    expenseId,
    scanId,
    merchant:     detail.merchant,
    amount:       detail.amount,
    category:     detail.category,
    confidence:   detail.confidence,
    processingMs: detail.processingMs,
  };

  const results = await Promise.allSettled(
    connectionIds.map(id => pushToConnection(userId, id, wsPayload))
  );

  let sent = 0, stale = 0, errors = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      r.value === "sent" ? sent++ : stale++;
    } else {
      errors++;
      logger.error("Failed to push to connection", { reason: r.reason });
    }
  }

  logger.info("WebSocket push complete", { sent, stale, errors });
  metrics.addMetric("WsMessagesSent",   MetricUnit.Count, sent);
  metrics.addMetric("WsStaleConns",     MetricUnit.Count, stale);

  // Partial errors are non-fatal — at least some tabs received the message.
  // Full failure (errors === connectionIds.length) will re-throw on the next
  // settled rejection, caught implicitly by Lambda retry / DLQ.

  if (errors > 0 && errors === connectionIds.length) {
    const firstRejection = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    throw firstRejection.reason;
  }
});