import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Annotations } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";

describe("EncryptionEnforcementAspect", () => {
  const env = { account: '123456789012', region: 'us-east-1' };

  beforeEach(() => {
    process.env.VITE_APP_URL = "https://staging.costscrunch.io";
    process.env.ALARM_LAMBDA_ERROR_RATE_THRESHOLD = "5";
  });

  it("should pass for the current stack configuration", () => {
    const app = new cdk.App();
    const stack = new CostsCrunchStack(app, "TestStack", {
      environment: "staging",
      env
    });

    const annotations = Annotations.fromStack(stack);
    const errors = annotations.all().filter(a => a.level === 'error');
    expect(errors.length).toBe(0);
  });

  it("should fail synthesis if an unencrypted bucket is added", () => {
    const app = new cdk.App();
    const stack = new CostsCrunchStack(app, "TestStack", {
      environment: "staging",
      env
    });

    // Add an unencrypted bucket (explicitly)
    new s3.CfnBucket(stack, "UnencryptedBucket", {});

    const annotations = Annotations.fromStack(stack);
    annotations.hasError("/TestStack/UnencryptedBucket", "S3 Bucket must have encryption configured.");
  });

  it("should fail synthesis if an unencrypted table is added", () => {
    const app = new cdk.App();
    const stack = new CostsCrunchStack(app, "TestStack", {
      environment: "staging",
      env
    });

    // Add an unencrypted table (L1 bypasses high-level defaults)
    new dynamodb.CfnTable(stack, "UnencryptedTable", {
        keySchema: [{ attributeName: "id", keyType: "HASH" }],
        attributeDefinitions: [{ attributeName: "id", attributeType: "S" }],
        provisionedThroughput: { readCapacityUnits: 5, writeCapacityUnits: 5 },
        sseSpecification: { sseEnabled: false }
    });

    const annotations = Annotations.fromStack(stack);
    annotations.hasError("/TestStack/UnencryptedTable", "DynamoDB Table must have SSE encryption enabled.");
  });
});
