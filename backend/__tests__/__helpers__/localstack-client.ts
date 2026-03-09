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

// ─── LocalStack connection config ─────────────────────────────────────────────
const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const REGION              = process.env.AWS_REGION ?? "us-east-1";

const BASE_CONFIG = {
  endpoint:    LOCALSTACK_ENDPOINT,
  region:      REGION,
  credentials: {
    accessKeyId:     "test",
    secretAccessKey: "test",
  },
  forcePathStyle: true,   // Required for S3 LocalStack
} as const;

// ── Clients ───────────────────────────────────────────────────────────────────

export const dynamodb = new DynamoDBClient(BASE_CONFIG);

export const ddbDoc = DynamoDBDocumentClient.from(dynamodb, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

export const s3  = new S3Client(BASE_CONFIG);
export const ses = new SESClient(BASE_CONFIG);
export const sqs = new SQSClient(BASE_CONFIG);
export const sns = new SNSClient(BASE_CONFIG);
export const eb  = new EventBridgeClient(BASE_CONFIG);
export const ssm = new SSMClient(BASE_CONFIG);

// ─── Constants matching the seed script ───────────────────────────────────────
export const TABLE_NAME  = process.env.TABLE_NAME  ?? "costscrunch-dev-main";
export const BUCKET_NAME = process.env.BUCKET_NAME ?? "costscrunch-dev-receipts-000000000000";
export const EVENT_BUS   = process.env.EVENT_BUS_NAME ?? "costscrunch-dev";
export const FROM_EMAIL  = "noreply@costscrunch.dev";

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
    headers: object | null;
    body: object | null;
    pathParameters: Record<string, string>;
    queryStringParameters: Record<string, string>;
    userId: string;
  }> = {}
) {
  const userId = overrides.userId ?? TEST_USER_ID;
  return {
    version:        "2.0",
    routeKey:       overrides.routeKey ?? "GET /expenses",
    rawPath:        overrides.path ?? "/expenses",
    rawQueryString: "",
    headers:        { },
    body:           overrides.body ? JSON.stringify(overrides.body) : null,
    pathParameters: overrides.pathParameters ?? {},
    queryStringParameters: overrides.queryStringParameters ?? {},
    requestContext: {
      http: {  method: overrides.method ?? "GET", path: overrides.path ?? "/", protocol: "HTTP/1.1", sourceIp: "0.0.0.0", userAgent: "..." },
      accountId:  "000000000000",
      apiId:      "test-api",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test.execute-api",
      requestId:  "test-request-id",
      routeKey: "ANY /",
      stage: "test",
      time: "01/Jan/2021:00:00:00 +0000",
      timeEpoch: 1609459200000,
      authorizer: {
        jwt: {
          claims: {
            sub:              userId,
            email:            `${userId}@costscrunch.dev`,
            "cognito:groups": "",
          },
        },
      },
    },
    isBase64Encoded: false,
  };
}

/** Wait for LocalStack to be fully ready */
export async function waitForLocalStack(maxWaitMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`${LOCALSTACK_ENDPOINT}/_localstack/health`);
      const json = (await res.json()) as { services: Record<string, string> };
      const allRunning = Object.values(json.services).every(
        (s) => s === "running" || s === "available"
      );
      if (allRunning) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`LocalStack not ready after ${maxWaitMs}ms`);
}

/** Clean up all items from the test table matching a pk prefix */
export async function cleanTable(pkPrefix: string): Promise<void> {
  const { ScanCommand, BatchWriteCommand } = await import("@aws-sdk/lib-dynamodb");
  const result = await ddbDoc.send(
    new ScanCommand({
      TableName:        TABLE_NAME,
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
          [TABLE_NAME]: chunk.map((item) => ({
            DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
          })),
        },
      })
    );
  }
}