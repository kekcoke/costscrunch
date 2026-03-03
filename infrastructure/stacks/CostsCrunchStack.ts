// ─── Costscrunch — AWS CDK Infrastructure Stack ────────────────────────────────
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

        // ── VPC & Subnets ───────────────────────────────────────────────────────
        const vpc = new ec2.Vpc(this, "CostsCrunchVPC", {
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: [
                { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
                { name: "private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
                { name: "isolated", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 28 },
            ],
            gatewayEndpoints: {
                S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
                DynamoDB: { service: ec2.GatewayVpcEndpointAwsService.DYNAMODB },
            },
        });

        // ─ VPC Interface Endpoints (keep traffic off the public internet) ───────────────
        for (const service of [
            ec2.InterfaceVpcEndpointAwsService.SSM,
            ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            ec2.InterfaceVpcEndpointAwsService.SQS,
            ec2.InterfaceVpcEndpointAwsService.SNS,
            ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,
        ]) {
            new ec2.InterfaceVpcEndpoint(this, `Endpoint${service.name.replace(/\./g, "")}`, 
            {
                vpc,
                service,
                privateDnsEnabled: true,
                subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            });
        }

        // ── DynamoDB Single Table ────────────────────────────────────────────────
        const table = new dynamodb.TableV2(this, "MainTable", {
        tableName: `${prefix}-main`,
        partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
        billing: dynamodb.Billing.onDemand(),
        encryption: dynamodb.TableEncryptionV2.customerManagedKey(kmsKey),
        pointInTimeRecovery: true,
        deletionProtection: isProd,
        timeToLiveAttribute: "ttl",
        removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        // Global Table replicas for prod
        replicas: isProd ? [{ region: "us-west-2" }] : [],
        globalSecondaryIndexes: [
            {
            indexName: "GSI1",
            partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
            },
            {
            indexName: "GSI2",
            partitionKey: { name: "gsi2pk", type: dynamodb.AttributeType.STRING },
            sortKey: { name: "gsi2sk", type: dynamodb.AttributeType.STRING },
            },
        ],
        });

        // ── S3 Buckets ────────────────────────────────────────────────
        const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
            bucketName: `${prefix}-receipts-${this.account} `,
            encryption: s3.BucketEncryption.KMS_MANAGED,
            encryptionKey: kmsKey,
            versioned: true,
            enforceSSL: true,
            removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
                    allowedOrigins: isProd ? [`https://${props.domainName}`] : ["*"],
                    allowedHeaders: ["*"],
                    maxAge: 3600,
                },
            ],
            lifecycleRules: [
                { transitions: [
                    { storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(30) } ] },
                    { expiration: Duration.days(365), noncurrentVersionExpiration: Duration.days(90) },
                ],
        });

        const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
            bucketName: `${prefix}-assets-${this.account}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        });

        // ── Cognito User Pool ────────────────────────────────────────────────
        const userPool = new cognito.UserPool(this, "UserPool", {
            userPoolName: `${prefix}-users`,
            selfSignUpEnabled: true,
            signInAliases: { email: true },
            autoVerify: { email: true },
            mfa: isProd ? cognito.Mfa.REQUIRED : cognito.Mfa.OFF,
            mfaSecondFactor: { sms: true, otp: true },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
                tempPasswordValidity: Duration.minutes(30),
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            standardAttributes: {
                email: { required: true, mutable: false },
                fullname: { required: true, mutable: true },
            },
            customAttributes: {
                plan: new cognito.StringAttribute({ mutable: true }),
                orgId: new cognito.StringAttribute({ mutable: true }),
            },
            removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
            standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
        });

        const userPoolClient = userPool.addClient("WebClient", {
            userPoolClientName: `${prefix}-web`,
            authFlows: {
                userSrp: true,
                userPassword: false, // disable plain password flow
            },
            oAuth: {
                flows: { authorizationCodeGrant: true },
                scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
                callbackUrls: isProd ? ["https://app.costscrunch.io/callback"] : ["http://localhost:3000/callback"],
                logoutUrls: isProd ? ["https://app.costscrunch.io/logout"] : ["http://localhost:3000/logout"],
            },
            accessTokenValidity: Duration.minutes(15),
            refreshTokenValidity: Duration.days(30),
            preventUserExistenceErrors: true,
            enableTokenRevocation: true,
        });

        // Cognito groups
        new cognito.CfnUserPoolGroup(this, "AdminGroup", { userPoolId: userPool.userPoolId, groupName: "admins", precedence: 1 });
        new cognito.CfnUserPoolGroup(this, "SupportGroup", { userPoolId: userPool.userPoolId, groupName: "support", precedence: 2 });
        new cognito.CfnUserPoolGroup(this, "BusinessGroup", { userPoolId: userPool.userPoolId, groupName: "business", precedence: 3 });
        new cognito.CfnUserPoolGroup(this, "ProGroup", { userPoolId: userPool.userPoolId, groupName: "pro", precedence: 4 });
        new cognito.CfnUserPoolGroup(this, "FreeGroup", { userPoolId: userPool.userPoolId, groupName: "free", precedence: 5 });

        // ── ElastiCache Redis ────────────────────────────────────────────────────
        const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, "RedisSubnets", {
            cacheSubnetGroupName: `${prefix}-redis-subnets`,
            description: "Subnet group for Redis cluster",
            subnetIds: vpc.isolatedSubnets.map(s => s.subnetId),                
        });

        const redisSg = new ec2.SecurityGroup(this, "RedisSg", { vpc, description: "Redis SG" });

        // upgrade prod to at least cache.t4g.small for better performance
        const redis = new elasticache.CfnReplicationGroup(this, "Redis", {
            replicationGroupDescription: `${prefix} Redis`,
            cacheNodeType: isProd ? "cache.t2.micro" : "cache.t2.micro",
            engine: "redis",
            engineVersion: "7.0",
            numCacheClusters: 1,
            automaticFailoverEnabled: isProd,
            multiAzEnabled: true,
            atRestEncryptionEnabled: true,
            transitEncryptionEnabled: true,
            cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName!,
            securityGroupIds: [redisSg.securityGroupId],
        });

        // ── SQS Queues ───────────────────────────────────────────────────────────
        const scanDlq = new sqs.Queue(this, "ScanDlq", {
            queueName: `${prefix}-scan-dlq`,
            retentionPeriod: Duration.days(14),
            encryption: sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
        });

        const notificationsDlq = new sqs.Queue(this, "NotifDlq", {
            queueName: `${prefix}-notif-dlq`,
            retentionPeriod: Duration.days(14),
            encryption: sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
        });

        const notificationsQueue = new sqs.Queue(this, "NotifQueue", {
            queueName: `${prefix}-notifications.fifo`,
            fifo: true,
            contentBasedDeduplication: true,
            visibilityTimeout: Duration.seconds(60),
            deadLetterQueue: { queue: notificationsDlq, maxReceiveCount: 3 },
            encryption: sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
        });
        }
}
