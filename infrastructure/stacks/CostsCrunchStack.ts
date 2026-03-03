// ─── SpendLens — AWS CDK Infrastructure Stack ────────────────────────────────
// Deploys: Cognito, DynamoDB, S3, API Gateway, Lambda Functions,
//          ElastiCache, CloudFront, WAF, EventBridge, SNS/Pinpoint

import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";

export interface CostsCrunchStackProps extends StackProps {
  environment: "dev" | "staging" | "prod";
  domainName?: string;
}

export class CostsCrunchStack extends Stack {
    constructor(scope: Construct, id: string, props: CostsCrunchStackProps) {
        super(scope, id, props);

        const { environment } = props;
        const isProd = environment === "prod";
        const prefix = `costscrunch-${environment}`;

        // ── KMS Key ─────────────────────────────────────────────────────────────
        const kmsKey = new kms.Key(this, "CostsCrunchKey", {
            alias: `${prefix}-main`,
            enableKeyRotation: true,
            description: "Primary KMS encryption key",
            removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        });
    }
}
