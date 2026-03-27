import { describe, it, expect } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
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
      Threshold: 3, // Matches staging config in CostsCrunchStack.ts
      EvaluationPeriods: 3,
      DatapointsToAlarm: 3,
    });
  });

  it("creates Lambda Duration Alarms with fixed staging threshold", () => {
    // CostsCrunchStack.ts uses a fixed durationP99 threshold for all functions in staging (20000ms)
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Duration",
      Threshold: 20000,
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

describe("CostsCrunchStack WAF", () => {
  const app = new cdk.App();
  process.env.VITE_APP_URL = "https://staging.costscrunch.io";
  process.env.ALARM_LAMBDA_ERROR_RATE_THRESHOLD = "5";

  const stack = new CostsCrunchStack(app, "TestStack", {
    environment: "staging",
    env: { account: "123456789012", region: "us-east-1" },
  });
  const template = Template.fromStack(stack);

  it("creates a CloudFront-scoped WebACL with 5 rules", () => {
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Scope: "CLOUDFRONT",
      DefaultAction: { Allow: {} },
      Rules: Match.arrayWith([
        Match.objectLike({ Name: "AWSManagedRulesCommonRuleSet", Priority: 1 }),
        Match.objectLike({ Name: "AWSManagedRulesSQLiRuleSet", Priority: 2 }),
        Match.objectLike({ Name: "AWSManagedRulesKnownBadInputsRuleSet", Priority: 3 }),
        Match.objectLike({ Name: "GlobalRateLimitPerIP", Priority: 4 }),
        Match.objectLike({ Name: "ReceiptUploadRateLimit", Priority: 5 }),
      ]),
    });
  });

  it("includes SQLi managed rule group", () => {
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "AWSManagedRulesSQLiRuleSet",
          Statement: {
            ManagedRuleGroupStatement: {
              VendorName: "AWS",
              Name: "AWSManagedRulesSQLiRuleSet",
            },
          },
        }),
      ]),
    });
  });

  it("sets global rate limit to 5000 per IP", () => {
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "GlobalRateLimitPerIP",
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: {
              Limit: 5000,
              AggregateKeyType: "IP",
            },
          },
        }),
      ]),
    });
  });

  it("scopes receipt upload rate limit to POST /receipts/upload at 200 per IP", () => {
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "ReceiptUploadRateLimit",
          Statement: {
            RateBasedStatement: {
              Limit: 200,
              AggregateKeyType: "IP",
              ScopeDownStatement: {
                AndStatement: {
                  Statements: Match.arrayWith([
                    {
                      ByteMatchStatement: {
                        FieldToMatch: { Method: {} },
                        PositionalConstraint: "EXACTLY",
                        SearchString: "POST",
                        TextTransformations: [{ Priority: 0, Type: "NONE" }],
                      },
                    },
                    {
                      ByteMatchStatement: {
                        FieldToMatch: { UriPath: {} },
                        PositionalConstraint: "EXACTLY",
                        SearchString: "/receipts/upload",
                        TextTransformations: [{ Priority: 0, Type: "NONE" }],
                      },
                    },
                  ]),
                },
              },
            },
          },
        }),
      ]),
    });
  });

  it("logs WAF requests to a CloudWatch log group with 90-day retention and redacts Authorization header", () => {
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 90,
      LogGroupName: "/aws/wafv2/costscrunch-staging-waf-logs",
    });

    // CfnLoggingConfiguration is a separate resource (CDK 2.241+)
    template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
      RedactedFields: [
        { SingleHeader: { name: "Authorization" } },
      ],
    });
  });

  it("attaches the WebACL to the CloudFront distribution", () => {
    // CfnWebACL ARN is synthesized as Fn::GetAtt — verify the distribution
    // references the WAF ACL resource via WebACLId.
    const distributions = template.findResources("AWS::CloudFront::Distribution");
    const dist = Object.values(distributions)[0] as any;
    expect(dist.Properties.DistributionConfig.WebACLId).toBeDefined();
    // WebACLId should be a { "Fn::GetAtt": ["WafAcl", "Arn"] } ref
    expect(typeof dist.Properties.DistributionConfig.WebACLId).toBe("object");
  });
});
