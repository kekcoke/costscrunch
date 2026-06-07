import { Construct } from "constructs";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as cdk from "aws-cdk-lib";

export interface EdgeConstructProps {
  prefix: string;
  isProd: boolean;
  isTest: boolean;
  environment: string;
  regionId: string;
  viteAppUrl: string;
  assetsBucket: s3.IBucket;
  httpApi: apigwv2.HttpApi;
  removalPolicy: RemovalPolicy;
}

export class EdgeConstruct extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly wafAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: EdgeConstructProps) {
    super(scope, id);
    const {
      prefix, isProd, isTest, environment, regionId,
      viteAppUrl, assetsBucket, httpApi, removalPolicy,
    } = props;

    const CORS_ALLOW_ORIGINS = isProd ? [viteAppUrl] : ["*"];
    const CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
    const CORS_ALLOW_HEADERS = ["Authorization", "Content-Type", "X-Idempotency-Key"];

    // CloudFront-scoped WebACLs require logs in us-east-1.
    // If deployed outside us-east-1, move this LogGroup to a separate us-east-1 stack.
    const wafLogGroup = new logs.LogGroup(this, "WafLogGroup", {
      logGroupName: `aws-waf-logs-costscrunch-${environment}`,
      retention:    logs.RetentionDays.THREE_MONTHS,
      removalPolicy,
    });

    this.wafAcl = new wafv2.CfnWebACL(this, "WafAcl", {
      name:          `${prefix}-waf`,
      scope:         "CLOUDFRONT",
      defaultAction: { allow: {} },
      description:   "CloudFront WAF: managed rules + rate limiting",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName:               isTest ? "TestWafMetric" : `${prefix.replace(/[^a-zA-Z0-9]/g, "")}WafMetric`,
        sampledRequestsEnabled:   true,
      },
      rules: [
        {
          name: "AWSManagedRulesCommonRuleSet", priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "CommonRuleSet", sampledRequestsEnabled: false },
          statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesCommonRuleSet" } },
        },
        {
          name: "AWSManagedRulesSQLiRuleSet", priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "SQLiRuleSet", sampledRequestsEnabled: false },
          statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesSQLiRuleSet" } },
        },
        {
          name: "AWSManagedRulesKnownBadInputsRuleSet", priority: 3,
          overrideAction: { none: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "BadInputs", sampledRequestsEnabled: false },
          statement: { managedRuleGroupStatement: { vendorName: "AWS", name: "AWSManagedRulesKnownBadInputsRuleSet" } },
        },
        {
          name: "GlobalRateLimitPerIP", priority: 4,
          action: { block: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "GlobalRateLimit", sampledRequestsEnabled: true },
          statement: { rateBasedStatement: { limit: 5000, aggregateKeyType: "IP" } },
        },
        {
          name: "ReceiptUploadRateLimit", priority: 5,
          action: { block: {} },
          visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: "ReceiptUploadRateLimit", sampledRequestsEnabled: true },
          statement: {
            rateBasedStatement: {
              limit: 200,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                andStatement: {
                  statements: [
                    {
                      byteMatchStatement: {
                        fieldToMatch: { method: {} },
                        positionalConstraint: "EXACTLY",
                        searchString: "POST",
                        textTransformations: [{ priority: 0, type: "NONE" }],
                      },
                    },
                    {
                      byteMatchStatement: {
                        fieldToMatch: { uriPath: {} },
                        positionalConstraint: "EXACTLY",
                        searchString: "/receipts/upload",
                        textTransformations: [{ priority: 0, type: "NONE" }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    });

    new wafv2.CfnLoggingConfiguration(this, "WafLoggingConfig", {
      logDestinationConfigs: [wafLogGroup.logGroupArn],
      redactedFields:        [{ singleHeader: { name: "Authorization" } }],
      resourceArn:           this.wafAcl.attrArn,
    });

    const corsHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "CorsPolicy", {
      responseHeadersPolicyName: `${prefix}-cors`,
      comment:                   "Add CORS headers at CDN layer",
      corsBehavior: {
        accessControlAllowOrigins:    CORS_ALLOW_ORIGINS,
        accessControlAllowHeaders:    CORS_ALLOW_HEADERS,
        accessControlAllowMethods:    CORS_ALLOW_METHODS,
        accessControlExposeHeaders:   CORS_ALLOW_HEADERS,
        accessControlAllowCredentials: false,
        accessControlMaxAge:          Duration.seconds(86400),
        originOverride:               true,
      },
    });

    this.distribution = new cloudfront.Distribution(this, "CfDistribution", {
      comment: `${prefix} CDN`,
      defaultBehavior: {
        origin:               new origins.S3Origin(assetsBucket as s3.Bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy:          cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(
            (isTest || cdk.Token.isUnresolved(httpApi.apiId))
              ? `dummy.execute-api.${regionId}.amazonaws.com`
              : `${httpApi.apiId}.execute-api.${regionId}.amazonaws.com`,
          ),
          viewerProtocolPolicy:   cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy:            cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:    cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods:         cloudfront.AllowedMethods.ALLOW_ALL,
          responseHeadersPolicy:  corsHeadersPolicy,
        },
      },
      webAclId:                this.wafAcl.attrArn,
      minimumProtocolVersion:  cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion:             cloudfront.HttpVersion.HTTP2_AND_3,
    });
  }
}
