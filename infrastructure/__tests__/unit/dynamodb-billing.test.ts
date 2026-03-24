import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../../stacks/CostsCrunchStack";

describe("DynamoDB Billing Configuration", () => {
  const app = new cdk.App();
  const stack = new CostsCrunchStack(app, "TestStack", {
    environment: "dev",
    env: { account: "123456789012", region: "us-east-1" },
  });
  const template = Template.fromStack(stack);

  it("MainTable should use On-Demand billing", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "costscrunch-dev-main",
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("ConnTable should use On-Demand billing", () => {
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      TableName: "costscrunch-dev-connections",
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("should use PAY_PER_REQUEST for all DynamoDB tables", () => {
    const tables = template.findResources("AWS::DynamoDB::GlobalTable");
    Object.values(tables).forEach((resource: any) => {
      expect(resource.Properties.BillingMode).toBe("PAY_PER_REQUEST");
    });
  });
});
