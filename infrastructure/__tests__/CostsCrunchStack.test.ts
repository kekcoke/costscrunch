import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CostsCrunchStack } from "../stacks/CostsCrunchStack";

describe("CostsCrunchStack Alarms", () => {
  const app = new cdk.App();
  
  // Set required env vars for stable synthesis during tests
  process.env.VITE_APP_URL = "https://staging.costscrunch.io";
  process.env.ALARM_LAMBDA_ERROR_RATE_THRESHOLD = "5";
  
  const stack = new CostsCrunchStack(app, "TestStack", {
    environment: "staging",
    env: { 
      account: "123456789012", 
      region: "us-east-1" 
    }
  });
  const template = Template.fromStack(stack);

  it("creates an SNS Topic for alarms", () => {
    template.resourceCountIs("AWS::SNS::Topic", 2); // TextractTopic + AlarmsTopic
  });

  it("creates Lambda Error Rate Alarms for all functions", () => {
    // We have 9 functions defined in the stack
    template.resourceCountIs("AWS::CloudWatch::Alarm", 21); // (9 functions * 2 alarms) + DynamoDB + Pipeline + DLQ
    
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      Threshold: 5,
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
    });
  });

  it("creates Lambda Duration Alarms with 80% threshold", () => {
    // For a 29s timeout, threshold = 29 * 0.8 = 23.2 (IEEE 754: 23.200000000000003)
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Duration",
      Threshold: 29 * 0.8,
    });
    // For 60s timeout (image-preprocess), threshold should be 48
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Duration",
      Threshold: 48,
    });
  });

  it("creates DynamoDB Throttling Alarm", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ThrottledRequests",
      Namespace: "AWS/DynamoDB",
      Threshold: 0,
      ComparisonOperator: "GreaterThanThreshold",
    });
  });

  it("creates Textract Pipeline Failure Alarm and Metric Filter", () => {
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: "?\"ERROR\" ?\"Failed to get expense analysis\" ?\"Textract error\"",
      MetricTransformations: [
        {
          MetricName: "TextractFailures",
          MetricNamespace: "CostsCrunch/Pipeline",
          MetricValue: "1",
        },
      ],
    });

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "TextractFailures",
      Threshold: 1,
    });
  });

  it("matches snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
