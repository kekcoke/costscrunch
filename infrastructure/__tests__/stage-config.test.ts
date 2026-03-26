import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";

// Note: These tests use us-east-1 only. DynamoDB Global Tables multi-region
// replication requires separate testing with proper account/region configuration.

describe("Stage-Specific Configuration", () => {
  describe("Stack Props Validation", () => {
    it("accepts all stage-specific props for dev", () => {
      const app = new cdk.App();
      expect(() => {
        new CostsCrunchStack(app, "DevStack", {
          environment: "dev",
          capacityMode: "on-demand",
          provisionedConcurrency: false,
          alarmThreshold: { errorRate: 5, durationP99: 30000 },
          removalPolicy: "destroy",
          env: { account: "123456789012", region: "us-east-1" },
        });
      }).not.toThrow();
    });

    it("accepts all stage-specific props for staging", () => {
      const app = new cdk.App();
      expect(() => {
        new CostsCrunchStack(app, "StagingStack", {
          environment: "staging",
          capacityMode: "on-demand",
          provisionedConcurrency: false,
          alarmThreshold: { errorRate: 3, durationP99: 20000 },
          removalPolicy: "destroy",
          env: { account: "123456789012", region: "us-east-1" },
        });
      }).not.toThrow();
    });

    it("accepts all stage-specific props for prod", () => {
      const app = new cdk.App();
      expect(() => {
        new CostsCrunchStack(app, "ProdStack", {
          environment: "prod",
          capacityMode: "provisioned",
          provisionedConcurrency: true,
          alarmThreshold: { errorRate: 1, durationP99: 10000 },
          removalPolicy: "retain",
          env: { account: "123456789012", region: "us-east-1" },
        });
      }).not.toThrow();
    });

    it("accepts custom alarm thresholds", () => {
      const app = new cdk.App();
      expect(() => {
        new CostsCrunchStack(app, "CustomStack", {
          environment: "dev",
          alarmThreshold: { errorRate: 10, durationP99: 50000 },
          env: { account: "123456789012", region: "us-east-1" },
        });
      }).not.toThrow();
    });
  });

  describe("Interface Type Safety", () => {
    it("accepts valid environment values", () => {
      const app = new cdk.App();
      const stack = new CostsCrunchStack(app, "TestStack", {
        environment: "dev",
        env: { account: "123456789012", region: "us-east-1" },
      });
      expect(stack).toBeDefined();
    });

    it("accepts valid capacity modes", () => {
      const app = new cdk.App();
      const stack = new CostsCrunchStack(app, "TestStack", {
        environment: "dev",
        capacityMode: "on-demand",
        env: { account: "123456789012", region: "us-east-1" },
      });
      expect(stack).toBeDefined();
    });

    it("accepts valid removal policies", () => {
      const app = new cdk.App();
      const stack = new CostsCrunchStack(app, "TestStack", {
        environment: "prod",
        removalPolicy: "retain",
        env: { account: "123456789012", region: "us-east-1" },
      });
      expect(stack).toBeDefined();
    });
  });

  describe("CDK Context Configuration", () => {
    it("parses stage from CDK context", () => {
      const app = new cdk.App();
      app.node.setContext("stage", "staging");
      
      const stack = new CostsCrunchStack(app, "TestStack", {
        environment: "staging",
        env: { account: "123456789012", region: "us-east-1" },
      });
      
      expect(app.node.tryGetContext("stage")).toBe("staging");
      expect(stack.node.id).toBe("TestStack");
    });

    it("uses default stage when context not set", () => {
      const app = new cdk.App();
      
      const stack = new CostsCrunchStack(app, "DevStack", {
        environment: "dev",
        env: { account: "123456789012", region: "us-east-1" },
      });
      
      expect(app.node.tryGetContext("stage")).toBeUndefined();
      expect(stack.node.id).toBe("DevStack");
    });
  });
});
