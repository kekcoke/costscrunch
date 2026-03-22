/**
 * Shared AWS SDK v3 client factory.
 *
 * AWS SDK v3 does NOT automatically read `AWS_ENDPOINT_URL` for service
 * endpoints. When running locally (SAM or LocalStack), we must explicitly
 * pass the endpoint to each client constructor.
 *
 * This module centralises that logic so every handler gets the correct
 * configuration without duplicating boilerplate.
 */

import { DynamoDBClient, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TranslateConfig } from "@aws-sdk/lib-dynamodb";
import { S3Client, S3ClientConfig } from "@aws-sdk/client-s3";

/** Base config shared by all AWS clients when running against LocalStack. */
function baseConfig(): Record<string, unknown> {
  const endpoint = process.env.AWS_ENDPOINT_URL;
  if (!endpoint) return {};

  return {
    endpoint,
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "test",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    },
  };
}

/**
 * Create a pre-configured DynamoDBDocumentClient.
 *
 * @param translateConfig — optional marshalling overrides
 *   (e.g. `{ marshallOptions: { removeUndefinedValues: true } }`)
 */
export function createDynamoDBDocClient(
  translateConfig?: TranslateConfig,
): DynamoDBDocumentClient {
  const client = new DynamoDBClient(baseConfig() as DynamoDBClientConfig);
  return translateConfig
    ? DynamoDBDocumentClient.from(client, translateConfig)
    : DynamoDBDocumentClient.from(client);
}

/**
 * Create a pre-configured S3Client.
 *
 * Forces path-style access when an explicit endpoint is set
 * (required by LocalStack / MinIO).
 */
export function createS3Client(): S3Client {
  const cfg = baseConfig() as S3ClientConfig;
  if (process.env.AWS_ENDPOINT_URL) {
    (cfg as any).forcePathStyle = true;
  }
  return new S3Client(cfg);
}
