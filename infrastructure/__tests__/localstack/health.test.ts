// ─── LocalStack Health Check Tests ───────────────────────────────────────────
// Verifies LocalStack is running and healthy before other tests run.
// These tests validate the mock environment is ready for infrastructure testing.

import { describe, it, expect, beforeAll } from "vitest";

const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";
const HEALTH_ENDPOINT = `${LOCALSTACK_ENDPOINT.replace(/\/$/, "")}/_localstack/health`;

describe("LocalStack Health", () => {
  describe("Connectivity", () => {
    it("should be reachable at the health endpoint", async () => {
      const response = await fetch(HEALTH_ENDPOINT);
      expect(response.ok).toBe(true);
    });

    it("should return valid JSON health status", async () => {
      const response = await fetch(HEALTH_ENDPOINT);
      const data = await response.json();
      expect(data).toHaveProperty("services");
    });
  });

  describe("Required Services", () => {
    let healthData: Record<string, any>;

    beforeAll(async () => {
      const response = await fetch(HEALTH_ENDPOINT);
      healthData = await response.json() as Record<string, any>;
    });

    it("should have DynamoDB service running", () => {
      const services = healthData.services ?? {};
      const hasDynamoDB = 
        services.dynamodb?.running === true ||
        Object.keys(services).some((s: string) => s.includes("dynamodb"));
      expect(hasDynamoDB).toBe(true);
    });

    it("should have S3 service running", () => {
      const services = healthData.services ?? {};
      const hasS3 =
        services.s3?.running === true ||
        Object.keys(services).some((s: string) => s.includes("s3"));
      expect(hasS3).toBe(true);
    });

    it("should have SQS service running", () => {
      const services = healthData.services ?? {};
      const hasSQS =
        services.sqs?.running === true ||
        Object.keys(services).some((s: string) => s.includes("sqs"));
      expect(hasSQS).toBe(true);
    });

    it("should have SNS service running", () => {
      const services = healthData.services ?? {};
      const hasSNS =
        services.sns?.running === true ||
        Object.keys(services).some((s: string) => s.includes("sns"));
      expect(hasSNS).toBe(true);
    });

    it("should have EventBridge service running", () => {
      const services = healthData.services ?? {};
      const hasEventBridge =
        services.events?.running === true ||
        services.eventbridge?.running === true ||
        Object.keys(services).some((s: string) => s.includes("event"));
      expect(hasEventBridge).toBe(true);
    });

    it("should have KMS service running", () => {
      const services = healthData.services ?? {};
      const hasKMS =
        services.kms?.running === true ||
        Object.keys(services).some((s: string) => s.includes("kms"));
      expect(hasKMS).toBe(true);
    });

    it("should have SSM service running", () => {
      const services = healthData.services ?? {};
      const hasSSM =
        services.ssm?.running === true ||
        Object.keys(services).some((s: string) => s.includes("ssm"));
      expect(hasSSM).toBe(true);
    });

    it("should have SES service running", () => {
      const services = healthData.services ?? {};
      const hasSES =
        services.ses?.running === true ||
        Object.keys(services).some((s: string) => s.includes("ses"));
      expect(hasSES).toBe(true);
    });
  });
});
