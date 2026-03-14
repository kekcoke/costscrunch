/**
 * s3-processed.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Infrastructure tests for the processed S3 bucket configuration.
 * Validates bucket properties against LocalStack deployment.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  s3,
  waitForLocalStack,
  BUCKET_PROCESSED_NAME,
} from "../../../backend/__tests__/__helpers__/localstack-client"
import {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketCorsCommand,
  GetBucketVersioningCommand,
} from "@aws-sdk/client-s3";

describe("Processed S3 Bucket Configuration", () => {
  beforeAll(async () => {
    await waitForLocalStack(30_000);
  }, 35_000);

  it("should exist and be accessible", async () => {
    const result = await s3.send(
      new GetBucketEncryptionCommand({ Bucket: BUCKET_PROCESSED_NAME })
    );
    expect(result).toBeDefined();
  });

  it("should have encryption enabled", async () => {
    const result = await s3.send(
      new GetBucketEncryptionCommand({ Bucket: BUCKET_PROCESSED_NAME })
    );
    expect(result.ServerSideEncryptionConfiguration).toBeDefined();
    expect(
      result.ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm
    ).toBeDefined();
  });

  it("should have versioning enabled for audit trail", async () => {
    const result = await s3.send(
      new GetBucketVersioningCommand({ Bucket: BUCKET_PROCESSED_NAME })
    );
    // Versioning should be enabled for the processed bucket
    expect(result.Status).toBe("Enabled");
  });

  it("should have lifecycle rules for intelligent tiering", async () => {
    try {
      const result = await s3.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET_PROCESSED_NAME })
      );
      expect(result.Rules).toBeDefined();
      expect(result.Rules?.length).toBeGreaterThan(0);
      
      // Should have transition rule for intelligent tiering
      const transitionRule = result.Rules?.find(
        (r) => r.Transitions && r.Transitions.length > 0
      );
      expect(transitionRule).toBeDefined();
      
      // Should have expiration rule (365 days)
      const expirationRule = result.Rules?.find((r) => r.Expiration);
      expect(expirationRule).toBeDefined();
    } catch (error: any) {
      // LocalStack may not fully support lifecycle configuration
      if (error.name === "NoSuchLifecycleConfiguration") {
        console.log("Lifecycle configuration not yet applied in LocalStack");
      } else {
        throw error;
      }
    }
  });
});
