// ─── S3 Infrastructure Tests ──────────────────────────────────────────────────
// Validates S3 buckets match CostsCrunchStack.ts configuration.
// Tests bucket existence, encryption, versioning, CORS, lifecycle rules.

import { describe, it, expect, beforeAll } from "vitest";
import {
  S3Client,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetPublicAccessBlockCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new S3Client({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  forcePathStyle: true,
});

const PREFIX = "costscrunch-dev";
const BUCKET_RECEIPTS = `${PREFIX}-receipts-000000000000`;
const BUCKET_ASSETS = `${PREFIX}-assets-000000000000`;

describe("S3 Buckets", () => {
  describe("Bucket Existence", () => {
    it("should have receipts bucket created", async () => {
      const response = await client.send(new ListBucketsCommand({}));
      const bucketNames = response.Buckets?.map((b) => b.Name) ?? [];
      expect(bucketNames).toContain(BUCKET_RECEIPTS);
    });

    it("should have assets bucket created", async () => {
      const response = await client.send(new ListBucketsCommand({}));
      const bucketNames = response.Buckets?.map((b) => b.Name) ?? [];
      expect(bucketNames).toContain(BUCKET_ASSETS);
    });
  });

  describe("Receipts Bucket Configuration", () => {
    it("should have versioning enabled", async () => {
      const response = await client.send(
        new GetBucketVersioningCommand({ Bucket: BUCKET_RECEIPTS })
      );
      expect(response.Status).toBe("Enabled");
    });

    it("should have encryption enabled", async () => {
      const response = await client.send(
        new GetBucketEncryptionCommand({ Bucket: BUCKET_RECEIPTS })
      );
      const algorithm = response.ServerSideEncryptionConfiguration?.Rules?.[0]
        ?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
      expect(algorithm).toBe("aws:kms");
    });

    it("should have CORS configured for allowed origins", async () => {
      const response = await client.send(
        new GetBucketCorsCommand({ Bucket: BUCKET_RECEIPTS })
      );
      const corsRules = response.CORSRules ?? [];
      expect(corsRules.length).toBeGreaterThan(0);

      const allowedOrigins = corsRules[0].AllowedOrigins ?? [];
      expect(allowedOrigins).toContain("http://localhost:3001"); // SAM CLI / Option 3
      expect(allowedOrigins).toContain("http://localhost:5173"); // Vite dev server
    });

    it("should allow PUT and GET methods", async () => {
      const response = await client.send(
        new GetBucketCorsCommand({ Bucket: BUCKET_RECEIPTS })
      );
      const methods = response.CORSRules?.[0]?.AllowedMethods ?? [];
      expect(methods).toContain("PUT");
      expect(methods).toContain("GET");
    });

    it("should have lifecycle rules configured", async () => {
      const response = await client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET_RECEIPTS })
      );
      const rules = response.Rules ?? [];
      expect(rules.length).toBeGreaterThan(0);

      // Check for intelligent tiering transition rule
      const tieringRule = rules.find((r) =>
        r.Transitions?.some((t) => t.StorageClass === "INTELLIGENT_TIERING")
      );
      expect(tieringRule).toBeDefined();

      // Check for expiration rule
      const expirationRule = rules.find((r) => r.Expiration);
      expect(expirationRule).toBeDefined();
    });
  });

  describe("Assets Bucket Configuration", () => {
    it("should have public access blocked", async () => {
      const response = await client.send(
        new GetPublicAccessBlockCommand({ Bucket: BUCKET_ASSETS })
      );
      const config = response.PublicAccessBlockConfiguration;
      expect(config?.BlockPublicAcls).toBe(true);
      expect(config?.IgnorePublicAcls).toBe(true);
      expect(config?.BlockPublicPolicy).toBe(true);
      expect(config?.RestrictPublicBuckets).toBe(true);
    });

    it("should have encryption enabled", async () => {
      const response = await client.send(
        new GetBucketEncryptionCommand({ Bucket: BUCKET_ASSETS })
      );
      const algorithm = response.ServerSideEncryptionConfiguration?.Rules?.[0]
        ?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
      expect(algorithm).toBe("aws:kms");
    });
  });
});
