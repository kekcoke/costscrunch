/**
 * localstack-client.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable AWS SDK clients pre-configured for LocalStack.
 * Import these in integration tests instead of the default SDK clients.
 *
 * Usage:
 *   import { ddbDoc, s3, ses, eb } from "../helpers/localstack-client";
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SNSClient } from "@aws-sdk/client-sns";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { SSMClient } from "@aws-sdk/client-ssm";
import { APIGatewayProxyEventV2 } from "aws-lambda/trigger/api-gateway-proxy.js";

// ─── LocalStack connection config ─────────────────────────────────────────────
function getBaseConfig() {
  return {
    endpoint:    "http://localhost:4566",
    region:      "us-east-1",
    credentials: {
      accessKeyId:     "test",
      secretAccessKey: "test",
    },
    forcePathStyle: true,   // Required for S3 LocalStack
} as const;
}

// ── Clients ───────────────────────────────────────────────────────────────────

export const dynamodb = new DynamoDBClient(getBaseConfig());

export const ddbDoc = DynamoDBDocumentClient.from(dynamodb, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

export const s3  = new S3Client(getBaseConfig());
export const ses = new SESClient(getBaseConfig());
export const sqs = new SQSClient(getBaseConfig());
export const sns = new SNSClient(getBaseConfig());
export const eb  = new EventBridgeClient(getBaseConfig());
export const ssm = new SSMClient(getBaseConfig());

// ─── Constants matching the seed script ───────────────────────────────────────
export const TABLE_NAME_MAIN  = process.env.TABLE_NAME_MAIN  ?? "costscrunch-dev-main";
export const TABLE_NAME_CONNECTIONS = process.env.TABLE_NAME_CONNECTIONS 
  ?? "costscrunch-dev-connections";
export const BUCKET_RECEIPTS_NAME = process.env.BUCKET_RECEIPTS_NAME ?? "costscrunch-dev-receipts-000000000000";
export const EVENT_BUS_NAME   = process.env.EVENT_BUS_NAME ?? "costscrunch-dev-events";
export const REDIS_HOST  = ""
export const REDIS_PORT  = "6379"
export const FROM_EMAIL  = "noreply@costscrunch.dev";
export const PREFIX      = "costscrunch-dev";
export const ENVIRONMENT = "dev"
export const LOG_LEVEL   = "INFO"

// ─── Test data helpers ────────────────────────────────────────────────────────
export const TEST_USER_ID  = "test-user-001";
export const TEST_USER_ID2 = "test-user-002";
export const TEST_GROUP_ID = "test-group-001";

/** Make an API Gateway v2 event shape suitable for Lambda handlers */
export function makeApiEvent(
  overrides: Partial<{
    routeKey: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body: object | null;
    pathParameters: Record<string, string>;
    queryStringParameters: Record<string, string>;
    userId: string;
  }> = {}
): APIGatewayProxyEventV2 {
  const userId = overrides.userId ?? TEST_USER_ID;
  
  // Return a type-cast object that satisfies the interface
  return {
    version: "2.0",
    routeKey: overrides.routeKey ?? "GET /expenses",
    rawPath: overrides.path ?? "/expenses",
    rawQueryString: "",
    headers: overrides.headers ?? {},
    body: overrides.body ? JSON.stringify(overrides.body) : null,
    pathParameters: overrides.pathParameters,
    queryStringParameters: overrides.queryStringParameters,
    requestContext: {
      http: {
        method: overrides.method ?? "GET",
        path: overrides.path ?? "/",
        protocol: "HTTP/1.1",
        sourceIp: "0.0.0.0",
        userAgent: "vitest",
      },
      accountId: "000000000000",
      apiId: "test-api",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test.execute-api",
      requestId: "test-request-id",
      routeKey: overrides.routeKey ?? "ANY /",
      stage: "test",
      time: "01/Jan/2021:00:00:00 +0000",
      timeEpoch: 1609459200000,
      authorizer: {
        jwt: {
          claims: {
            sub: userId,
            email: `${userId}@costscrunch.dev`,
          },
          scopes: [],
        },
      },
    } as any, // Cast specific nested parts to avoid deep interface mismatches
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

export async function waitForLocalStack(maxWaitMs = 30_000): Promise<void> {
  const endpoint = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
  const healthUrl = `${endpoint.replace(/\/$/, "")}/_localstack/health`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return; // 200 = LocalStack is up and accepting requests
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`LocalStack not ready after ${maxWaitMs}ms at ${healthUrl}`);
}

/** Clean up all items from the test table matching a pk prefix */
export async function cleanTable(pkPrefix: string): Promise<void> {
  const { ScanCommand, BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
  const result = await ddbDoc.send(
    new ScanCommand({
      TableName:        TABLE_NAME_MAIN,
      FilterExpression: "begins_with(pk, :p)",
      ExpressionAttributeValues: { ":p": pkPrefix },
      ProjectionExpression: "pk, sk",
    })
  );
  const items = result.Items ?? [];
  if (items.length === 0) return;

  // BatchWrite in chunks of 25
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await ddbDoc.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME_MAIN]: chunk.map((item) => ({
            DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
          })),
        },
      })
    );
  }
}