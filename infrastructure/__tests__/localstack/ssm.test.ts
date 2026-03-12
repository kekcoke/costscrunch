// ─── SSM Parameter Infrastructure Tests ────────────────────────────────────────
// Validates SSM parameters match CostsCrunchStack.ts configuration.
// Tests all required parameters for Lambda environment variables.

import { describe, it, expect } from "vitest";
import {
  SSMClient,
  GetParameterCommand,
} from "@aws-sdk/client-ssm";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new SSMClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const PARAM_PREFIX = "/costscrunch/dev";

const REQUIRED_PARAMS = [
  { name: "table-name", expectedPattern: /^costscrunch-dev-main$/ },
  { name: "receipts-bucket", expectedPattern: /^costscrunch-dev-receipts-/ },
  { name: "event-bus-name", expectedPattern: /^costscrunch-dev-events$/ },
  { name: "user-pool-id", expectedPattern: /^local-pool-costscrunch-dev$/ },
  { name: "user-pool-client-id", expectedPattern: /^local-client-costscrunch-dev-web$/ },
  { name: "pinpoint-app-id", expectedPattern: /^local-pinpoint-stub-/ },
  { name: "redis-host", expectedPattern: /^localhost$/ },
  { name: "redis-port", expectedPattern: /^6379$/ },
  { name: "textract-topic-arn", expectedPattern: /textract-completion/ },
  { name: "conn-table-name", expectedPattern: /^costscrunch-dev-connections$/ },
  { name: "ws-endpoint", expectedPattern: /localhost/ },
  { name: "bedrock-model-id", expectedPattern: /claude/ },
];

describe("SSM Parameters", () => {
  describe("Parameter Existence", () => {
    it("should have all required parameters", async () => {
      for (const param of REQUIRED_PARAMS) {
        const response = await client.send(
          new GetParameterCommand({ Name: `${PARAM_PREFIX}/${param.name}` })
        );
        expect(response.Parameter?.Value).toBeDefined();
      }
    });
  });

  describe("Parameter Values", () => {
    for (const param of REQUIRED_PARAMS) {
      it(`${param.name} should have correct value pattern`, async () => {
        const response = await client.send(
          new GetParameterCommand({ Name: `${PARAM_PREFIX}/${param.name}` })
        );
        const value = response.Parameter?.Value ?? "";
        expect(value).toMatch(param.expectedPattern);
      });
    }
  });

  describe("DynamoDB Table Parameters", () => {
    it("table-name should match main table name", async () => {
      const response = await client.send(
        new GetParameterCommand({ Name: `${PARAM_PREFIX}/table-name` })
      );
      expect(response.Parameter?.Value).toBe("costscrunch-dev-main");
    });

    it("conn-table-name should match connections table name", async () => {
      const response = await client.send(
        new GetParameterCommand({ Name: `${PARAM_PREFIX}/conn-table-name` })
      );
      expect(response.Parameter?.Value).toBe("costscrunch-dev-connections");
    });
  });

  describe("Cognito Mock Parameters", () => {
    it("user-pool-id should be mock pool ID", async () => {
      const response = await client.send(
        new GetParameterCommand({ Name: `${PARAM_PREFIX}/user-pool-id` })
      );
      expect(response.Parameter?.Value).toBe("local-pool-costscrunch-dev");
    });

    it("user-pool-client-id should be mock client ID", async () => {
      const response = await client.send(
        new GetParameterCommand({ Name: `${PARAM_PREFIX}/user-pool-client-id` })
      );
      expect(response.Parameter?.Value).toBe("local-client-costscrunch-dev-web");
    });
  });
});
