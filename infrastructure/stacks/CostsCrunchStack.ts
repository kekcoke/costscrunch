// ─── Costscrunch — AWS CDK Infrastructure Stack ────────────────────────────────
// Deploys: Cognito, DynamoDB, S3, HTTP API Gateway, WebSocket API Gateway,
//          Lambda Functions, ElastiCache, CloudFront, WAF, EventBridge,
//          SNS (Textract completion) + Pinpoint

import * as cdk from "aws-cdk-lib";
import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput, Aspects, Annotations } from "aws-cdk-lib";
import { Construct, IConstruct } from "constructs";
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
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { buildStackConfig } from "./StackConfig";

export interface AlarmThreshold {
  errorRate: number;
  durationP99: number;
}

export interface CostsCrunchStackProps extends StackProps {
  environment: "dev" | "staging" | "prod";
  domainName?: string;
  config?: StackConfig;
  /** DynamoDB and Lambda capacity mode: on-demand or provisioned */
  capacityMode?: "on-demand" | "provisioned";
  /** CloudWatch alarm thresholds */
  alarmThreshold?: AlarmThreshold;
  /** Enable Lambda provisioned concurrency for critical functions */
  provisionedConcurrency?: boolean;
  /** Removal policy for resources (destroy for dev, retain for prod) */
  removalPolicy?: "destroy" | "retain";
}

export class CostsCrunchStack extends Stack {
    constructor(scope: Construct, id: string, props: CostsCrunchStackProps) {
        super(scope, id, props);

        const { environment } = props;
        const isProd = environment === "prod";
        const isStaging = environment === "staging";
        const prefix = `costscrunch-${environment}`;

        // Stage-specific configuration with sensible defaults
        const capacityMode = props.capacityMode ?? (isProd ? "provisioned" : "on-demand");
        const alarmThreshold = props.alarmThreshold ?? {
            errorRate: isProd ? 1 : isStaging ? 3 : 5,
            durationP99: isProd ? 10000 : isStaging ? 20000 : 30000,
        };
        const useProvisionedConcurrency = props.provisionedConcurrency ?? isProd;
        const removalPolicy = props.removalPolicy === "retain"
            ? RemovalPolicy.RETAIN
            : RemovalPolicy.DESTROY;

        // Build or use provided configuration (useful for unit tests/Vitest)
        const config = props.config ?? buildStackConfig(this, this.account, this.region);

        // ── SSM Parameter Store ───────────────────────────────────────────────
        // Store configuration values securely; Lambdas retrieve at runtime
        const bedrockModelIdParam = new ssm.StringParameter(this, "BedrockModelId", {
            parameterName: `/${prefix}/bedrock-model-id`,
            stringValue: process.env.BEDROCK_MODEL_ID ?? "foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
            tier: ssm.ParameterTier.STANDARD,
        });

        const viteAppUrlParam = new ssm.StringParameter(this, "ViteAppUrl", {
            parameterName: `/${prefix}/vite-app-url`,
            stringValue: process.env.VITE_APP_URL ?? "https://app.costscrunch.io",
            tier: ssm.ParameterTier.STANDARD,
        });

        // ── Secrets Manager ───────────────────────────────────────────────────
        // Store sensitive notification config as JSON; Lambdas retrieve at runtime via GetSecretValue.
        const notificationSecret = new secretsmanager.Secret(this, "NotificationSecret", {
            secretName: `${prefix}/notification-config`,
            description: "Notification service configuration (email, Pinpoint)",
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    fromEmail: "noreply@costscrunch.com",
                    pinpointAppId: isProd ? "REPLACE_WITH_ACTUAL_ID" : "dummy-pinpoint-id",
                }),
                generateStringKey: "unused"
            }
        });

        // SSM parameters for non-sensitive but environment-specific config
        new ssm.StringParameter(this, "FromEmail", {
            parameterName: `/${prefix}/from-email`,
            stringValue: "noreply@costscrunch.com",
            description: "Default sender email for SES notifications",
        });

        new ssm.StringParameter(this, "PinpointAppId", {
            parameterName: `/${prefix}/pinpoint-app-id`,
            stringValue: isProd ? "REPLACE_WITH_ACTUAL_ID" : "dummy-pinpoint-id",
            description: "AWS Pinpoint application ID for push notifications",
        });

        // ── KMS Key ─────────────────────────────────────────────────────────────
        const kmsKey = new kms.Key(this, "CostsCrunchKey", {
            alias: `${prefix}-main`,
            enableKeyRotation: true,
            description: "Primary KMS encryption key",
            removalPolicy,
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
        const vpcServices = [
            { svc: ec2.InterfaceVpcEndpointAwsService.SSM, id: "SSM" },
            { svc: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER, id: "SecretsManager" },
            { svc: ec2.InterfaceVpcEndpointAwsService.SQS, id: "SQS" },
            { svc: ec2.InterfaceVpcEndpointAwsService.SNS, id: "SNS" },
            { svc: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE, id: "EventBridge" },
        ];

        for (const { svc, id } of vpcServices) {
            new ec2.InterfaceVpcEndpoint(this, `Endpoint${id}`, {
                vpc,
                service: svc,
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
            removalPolicy,
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
                {
                    indexName: "GSI3",
                    partitionKey: { name: "gsi3pk", type: dynamodb.AttributeType.STRING },
                    sortKey: { name: "gsi3sk", type: dynamodb.AttributeType.STRING },
                },
                {
                    indexName: "ReceiptHashIndex",
                    partitionKey: { name: "receiptHash", type: dynamodb.AttributeType.STRING },
                    projectionType: dynamodb.ProjectionType.ALL,
                },
            ],
        });

        // ── WebSocket Connection Table ────────────────────────────────────────────
        // Stores active API Gateway WebSocket connectionIds keyed by userId.
        // Written by $connect Lambda; read by ws-notifier.ts; pruned on GoneException.
        const connTable = new dynamodb.TableV2(this, "ConnTable", {
            tableName:     `${prefix}-connections`,
            partitionKey:  { name: "pk", type: dynamodb.AttributeType.STRING },
            sortKey:       { name: "sk", type: dynamodb.AttributeType.STRING },
            billing:       dynamodb.Billing.onDemand(),
            encryption:    dynamodb.TableEncryptionV2.customerManagedKey(kmsKey),
            timeToLiveAttribute: "ttl",
            removalPolicy,
        });

        // ── DynamoDB Cost Estimates & Outputs ─────────────────────────────────────
        // 10K writes/day @ $1.25/million = $0.0125/day
        // 50K reads/day  @ $0.25/million = $0.0125/day
        // Storage: ~10GB @ $0.25/GB/mo = $0.08/day
        // Total Estimated Launch Cost: ~$0.10/day per table (excl. GSI replication)
        new CfnOutput(this, "MainTableCostNote", { 
            value: "Estimated $3-5/mo for 10K writes/50K reads daily (On-Demand)",
            description: "Cost note for MainTable launch capacity"
        });
        new CfnOutput(this, "ConnTableCostNote", {
            value: "Estimated <$1/mo for connection management (On-Demand)",
            description: "Cost note for ConnTable launch capacity"
        });

        // ── Account & Region Utilities ───────────────────────────────────────────
        const { accountId, regionId, isTest } = config;

        // Resolve VITE_APP_URL from SSM parameter (supports runtime updates without redeploy)
        const viteAppUrl = viteAppUrlParam.stringValue;

        // ── S3 Buckets ────────────────────────────────────────────────
        // Upload bucket: initial user uploads (triggers image-preprocess Lambda)
        const uploadsBucket = new s3.Bucket(this, "UploadsBucket", {
            bucketName: `${prefix}-uploads-${accountId}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: kmsKey,
            versioned: false,
            enforceSSL: true,
            removalPolicy,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.GET],
                    allowedOrigins: isProd ? [viteAppUrl] : ["*"],
                    allowedHeaders: ["*"],
                    maxAge: 3600,
                },
            ],
            lifecycleRules: [
                { expiration: Duration.days(3) }, // Auto-delete after 7 days (processed files moved to processed bucket)
            ],
        });

        // Processed bucket: compressed images (triggers receipts Lambda)
        const processedBucket = new s3.Bucket(this, "ProcessedBucket", {
            bucketName: `${prefix}-processed-${accountId}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: kmsKey,
            versioned: true,
            enforceSSL: true,
            removalPolicy,
            lifecycleRules: 
            [
                { 
                    transitions: [
                    { 
                        storageClass: s3.StorageClass.INTELLIGENT_TIERING, 
                        transitionAfter: Duration.days(15) 
                    } 
                ], 
                expiration: Duration.days(30), 
                noncurrentVersionExpiration: Duration.days(7) 
                },
            ],
        });

        // Receipts bucket: for Textract analysis results (now secondary)
        const receiptsBucket = new s3.Bucket(this, "ReceiptsBucket", {
            bucketName: `${prefix}-receipts-${accountId}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: kmsKey,
            versioned: true,
            enforceSSL: true,
            removalPolicy,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
                    allowedOrigins: isProd ? [viteAppUrl] : ["*"],
                    allowedHeaders: ["*"],
                    maxAge: 3600,
                },
            ],
            lifecycleRules: [
                { transitions: [
                    { storageClass: s3.StorageClass.INTELLIGENT_TIERING, transitionAfter: Duration.days(15) } ] },
                    { expiration: Duration.days(30), noncurrentVersionExpiration: Duration.days(7) },
                ],
        });

        const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
            bucketName: `${prefix}-assets-${accountId}`,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: kmsKey,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy,
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
                tempPasswordValidity: Duration.days(7),
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
            removalPolicy,
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
                callbackUrls: isProd ? [`${viteAppUrl}/callback`] : ["http://localhost:3000/callback"],
                logoutUrls: isProd ? [`${viteAppUrl}/logout`] : ["http://localhost:3000/logout"],
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
        // https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/CacheNodes.SupportedTypes.html
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
        // Generic DLQ Factory for reusability
        const createDlq = (id: string, name: string) => new sqs.Queue(this, id, {
            queueName: `${prefix}-${name}`,
            retentionPeriod: Duration.days(14),
            encryption: sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
        });

        const scanDlq = createDlq("ScanDlq", "scan-dlq");

        // Main Processing Queue (SNS -> SQS -> Lambda)
        const scanQueue = new sqs.Queue(this, "ScanQueue", {
            queueName: `${prefix}-scan-queue`,
            visibilityTimeout: Duration.seconds(120),
            encryption: sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
            deadLetterQueue: {
                queue: scanDlq,
                maxReceiveCount: 3,
            },
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

        // ── Textract SNS Topic ────────────────────────────────────────────────────────
        // Textract publishes a completion notification here when an async job finishes.
        // sns-webhook.ts Lambda subscribes to this topic.
        const textractTopic = new sns.Topic(this, "TextractTopic", {
            topicName:   `${prefix}-textract-completion`,
            masterKey:   kmsKey,
            displayName: "Textract async job completion",
        });

        // IAM role Textract assumes to publish to the SNS topic
        const textractSnsRole = new iam.Role(this, "TextractSnsRole", {
            roleName:  `${prefix}-textract-sns`,
            assumedBy: new iam.ServicePrincipal("textract.amazonaws.com"),
        });
        textractTopic.grantPublish(textractSnsRole);

        // ── EventBridge ──────────────────────────────────────────────────────────
        const eventBus = new events.EventBus(this, "EventBus", {
            eventBusName: `${prefix}-events`,
        });

        const eventArchive = new events.Archive(this, "EventArchive", {
            archiveName: `${prefix}-archive`,
            sourceEventBus: eventBus,
            retention: Duration.days(30),
            eventPattern: {
                source: [
                    "costscrunch.expenses", 
                    "costscrunch.users", 
                    "costscrunch.billing", 
                    "costscrunch.receipts"
                ],
            }
        });

        // ── Lambda Layer (Powertools) ──────────────────────────────────────────────────────────
        // https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/lambda-layers/#lookup-layer-arn-via-aws-ssm-parameter-store
        const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
            this, "PowertoolsLayer",
            `arn:aws:lambda:${regionId}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:22`
        );

        // ── Lambda Shared Environment ────────────────────────────────────────────
        // NOTE: Sensitive values (BEDROCK_MODEL_ID, FROM_EMAIL, PINPOINT_APP_ID) are NOT
        // stored in environment variables. Lambdas retrieve them at runtime via SSM/Secrets Manager.
        const sharedEnv = {
            AWS_XRAY_SDK_ENABLED: "true",
            AWS_XRAY_TRACING_NAME: `${prefix}-receipt-pipeline`,
            // Derived from env var, default to 1% (0.01) for production scale
            AWS_XRAY_SAMPLING_RATE: process.env.XRAY_SAMPLING_RATE ?? "0.01",
            TABLE_NAME_MAIN:      table.tableName,
            TABLE_NAME_CONNECTIONS: connTable.tableName,   // ws-notifier reads connection records
            EVENT_BUS_NAME:  eventBus.eventBusName,
            BUCKET_UPLOADS_NAME: uploadsBucket.bucketName,
            BUCKET_PROCESSED_NAME: processedBucket.bucketName,
            BUCKET_RECEIPTS_NAME: receiptsBucket.bucketName,
            REDIS_HOST: redis.attrPrimaryEndPointAddress,
            REDIS_PORT: redis.attrPrimaryEndPointPort,
            USER_POOL_ID: userPool.userPoolId,
            USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
            POWERTOOLS_SERVICE_NAME: "costscrunch",
            LOG_LEVEL: isProd ? "INFO" : "DEBUG",
            ENVIRONMENT: environment,
            AWS_REGION_ID: regionId, // Explicitly pass concrete region
            // SSM/Secrets Manager parameter paths for runtime retrieval
            SSM_BEDROCK_MODEL_ID: bedrockModelIdParam.parameterName,
            SSM_VITE_APP_URL: viteAppUrlParam.parameterName,
            SECRET_NOTIFICATION_ARN: notificationSecret.secretArn,
        };

        const sharedLambdaProps: Partial<NodejsFunctionProps> = {
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 1024,
            timeout: Duration.seconds(29),
            tracing: lambda.Tracing.ACTIVE,
            layers: [powertoolsLayer],
            bundling: {
                externalModules: [
                    "@aws-lambda-powertools/logger",
                    "@aws-lambda-powertools/metrics",
                    "@aws-lambda-powertools/tracer",
                ],
            },
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logRetention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
            reservedConcurrentExecutions: isProd ? 500 : 50,
            environment: sharedEnv,
        };

        // ── Lambda Functions ─────────────────────────────────────────────────────
        const expensesLambda = new NodejsFunction(this, "ExpensesLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/expenses/index.ts"),
            functionName: `${prefix}-expenses`,
            environment: { ...sharedEnv },
        });

        const groupsLambda = new NodejsFunction(this, "GroupsLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/groups/index.ts"),
            functionName: `${prefix}-groups`,
            environment: { ...sharedEnv },
        });

        const healthLambda = new NodejsFunction(this, "HealthLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/health/index.ts"),
            functionName: `${prefix}-health`,
            environment: { ...sharedEnv },
        });

        // ── Image Preprocessing Lambda ────────────────────────────────────────────
        // Triggered by S3 uploads, compresses images, and uploads to processed bucket.
        // Higher memory/timeout for image processing workloads.
        const imagePreprocessLambda = new NodejsFunction(this, "ImagePreprocessLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/image-preprocess/index.ts"),
            functionName: `${prefix}-image-preprocess`,
            memorySize: 2048,  // 2GB for image processing
            timeout: Duration.seconds(60),  // 60s for large images
            environment: {
                ...sharedEnv,
            },
        });

        const receiptsLambda = new NodejsFunction(this, "ReceiptsLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/receipts/index.ts"),
            functionName: `${prefix}-receipts`,
            // timeout removed: Lambda now returns immediately after StartExpenseAnalysis.
            // Textract async completion flows through sns-webhook Lambda instead.
            environment: {
                ...sharedEnv,
                TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
                TEXTRACT_ROLE_ARN:      textractSnsRole.roleArn,
            },
        });

        const analyticsLambda = new NodejsFunction(this, "AnalyticsLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/analytics/index.ts"),
            functionName: `${prefix}-analytics`,
            environment: { ...sharedEnv },
        });

        const notificationsLambda = new NodejsFunction(this, "NotificationsLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/notifications/index.ts"),
            functionName: `${prefix}-notifications`,
            environment: {
                ...sharedEnv,
                // FROM_EMAIL and PINPOINT_APP_ID retrieved from Secrets Manager at runtime
            },
        });

        // ── SNS Webhook Lambda ────────────────────────────────────────────────────
        // Receives Textract completion notifications from SNS.
        // Replaces the polling loop that was in receiptsLambda.
        const snsWebhookLambda = new NodejsFunction(this, "SnsWebhookLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/sns-webhook/index.ts"),
            functionName: `${prefix}-sns-webhook`,
            environment: {
                ...sharedEnv,
                TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
                TEXTRACT_ROLE_ARN:      textractSnsRole.roleArn,
            },
            logRetention: logs.RetentionDays.ONE_WEEK,
        });

        // ── WebSocket Notifier Lambda ──────────────────────────────────────────────
        // Triggered by EventBridge ReceiptScanCompleted.
        // Pushes results to the user's browser over the WebSocket API.
        const wsNotifierLambda = new NodejsFunction(this, "WsNotifierLambda", {
            ...sharedLambdaProps as any,
            entry: path.resolve(__dirname, "../../backend/src/lambdas/web-socket-notifier/index.ts"),
            functionName: `${prefix}-ws-notifier`,
            environment: {
                ...sharedEnv,
                // WEBSOCKET_ENDPOINT injected after wsApi is created (below)
            },
        });

        // ── IAM Permissions ──────────────────────────────────────────────────────
        // Main table
        table.grantReadWriteData(expensesLambda);
        table.grantReadWriteData(groupsLambda);
        table.grantReadWriteData(receiptsLambda);      // writes initial scan record
        table.grantReadWriteData(snsWebhookLambda);    // updates scan + expense records
        table.grantReadData(analyticsLambda);
        table.grantReadWriteData(notificationsLambda);

        // Connection table (ws-notifier reads; $connect Lambda writes)
        connTable.grantReadWriteData(wsNotifierLambda);

        // S3
        // Image preprocessing: read from uploads, write to processed
        uploadsBucket.grantRead(imagePreprocessLambda);
        processedBucket.grantPut(imagePreprocessLambda);
        
        // Receipts: presigned POST generation for processed bucket
        processedBucket.grantPut(receiptsLambda);       // presigned POST generation
        receiptsBucket.grantRead(snsWebhookLambda);    // Textract reads from here (via IAM role)

        // EventBridge
        eventBus.grantPutEventsTo(snsWebhookLambda);  // emits ReceiptScanCompleted
        eventBus.grantPutEventsTo(expensesLambda);

        // Textract: only receiptsLambda starts jobs; only snsWebhookLambda fetches results
        receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["textract:StartExpenseAnalysis"],
            resources: ["*"],
        }));
        receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["iam:PassRole"],
            resources: [textractSnsRole.roleArn],
        }));
        snsWebhookLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["textract:GetExpenseAnalysis"],
            resources: ["*"],
        }));

        // Bedrock: only snsWebhookLambda calls Claude (moved from receiptsLambda)
        // Model ID is stored in SSM Parameter Store; IAM policy grants access based on parameter value
        const bedrockModelId = bedrockModelIdParam.stringValue;
        const bedrockModelName = bedrockModelId.split('/').pop() ?? "claude-haiku";
        snsWebhookLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["bedrock:InvokeModel"],
            resources: [`arn:aws:bedrock:${regionId}::foundation-model/${bedrockModelName}`],
        }));

        // SNS: textractTopic -> scanQueue -> snsWebhookLambda
        textractTopic.addSubscription(new sns_subscriptions.SqsSubscription(scanQueue));
        snsWebhookLambda.addEventSource(new lambdaEventSources.SqsEventSource(scanQueue));

        // API Gateway Management: ws-notifier pushes messages to connections
        wsNotifierLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["execute-api:ManageConnections"],
            resources: [`arn:aws:execute-api:${regionId}:${accountId}:*/prod/POST/@connections/*`],
        }));

        // KMS
        kmsKey.grantEncryptDecrypt(expensesLambda);
        kmsKey.grantEncryptDecrypt(imagePreprocessLambda);
        kmsKey.grantEncryptDecrypt(receiptsLambda);
        kmsKey.grantEncryptDecrypt(snsWebhookLambda);
        kmsKey.grantEncryptDecrypt(groupsLambda);
        kmsKey.grantEncryptDecrypt(wsNotifierLambda);

        // SSM Parameter Store: Bedrock model ID
        bedrockModelIdParam.grantRead(snsWebhookLambda);

        // Secrets Manager: Notification config (fromEmail, pinpointAppId)
        notificationSecret.grantRead(notificationsLambda);

        // Notifications Lambda: SES + Pinpoint
        notificationsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions:   ["ses:SendEmail", "ses:SendTemplatedEmail", "mobiletargeting:SendMessages"],
            resources: ["*"],
        }));

        // Explicitly grant X-Ray permissions to all pipeline functions
        const xrayPolicy = new iam.PolicyStatement({
            actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
            resources: ["*"],
        });
        [imagePreprocessLambda, receiptsLambda, snsWebhookLambda, wsNotifierLambda].forEach(fn => {
            fn.addToRolePolicy(xrayPolicy);
        });

        // ── S3 → Lambda Event Sources ────────────────────────────────────────────────
        // Image preprocessing: triggered by uploads to the uploads bucket
        imagePreprocessLambda.addEventSource(new lambdaEventSources.S3EventSource(uploadsBucket, {
            events: [s3.EventType.OBJECT_CREATED],
            filters: [{ prefix: "uploads/" }],
        }));

        // Receipts: triggered by uploads to the processed bucket (compressed images)
        // Starts the async Textract job.
        // On completion Textract publishes to textractTopic → snsWebhookLambda.
        receiptsLambda.addEventSource(new lambdaEventSources.S3EventSource(processedBucket, {
            events: [s3.EventType.OBJECT_CREATED],
            filters: [{ prefix: "receipts/" }],
        }));

        // ── WebSocket API (API Gateway v2) ────────────────────────────────────────
        // Browsers connect to wss://ws.costscrunch.com; ws-notifier.ts pushes results.
        const wsApi = new apigwv2.WebSocketApi(this, "WsApi", {
            apiName: `${prefix}-ws`,
            // $connect: write connectionId to connTable (requires a small connect Lambda)
            // $disconnect: delete connectionId from connTable
            // $default: no-op (all real messages are server-push only)
        });

        const wsStage = new apigwv2.WebSocketStage(this, "WsStage", {
            webSocketApi:  wsApi,
            stageName:     "prod",
            autoDeploy:    true,
        });

        // Inject the WSS callback URL so ws-notifier can call @connections
        wsNotifierLambda.addEnvironment("WEBSOCKET_ENDPOINT", config.webSocketEndpoint || wsStage.callbackUrl);

        // ── EventBridge → Notifications Lambda ───────────────────────────────────
        // ReceiptScanCompleted fires both the WebSocket notifier AND the
        // existing notifications Lambda (email/push/Pinpoint).
        const wsNotifierDlq = new sqs.Queue(this, "WsNotifierDlq", {
            queueName:       `${prefix}-ws-notifier-dlq`,
            retentionPeriod: Duration.days(14),
            encryption:      sqs.QueueEncryption.KMS,
            encryptionMasterKey: kmsKey,
        });

        new events.Rule(this, "ScanCompletedNotifRule", {
            eventBus,
            ruleName: `${prefix}-scan-completed-notif`,
            eventPattern: {
                source:     ["costscrunch.receipts"],
                detailType: ["ReceiptScanCompleted"],
            },
            targets: [new targets.LambdaFunction(notificationsLambda, {
                deadLetterQueue: notificationsDlq,
                maxEventAge:     Duration.hours(2),
                retryAttempts:   3,
            })],
        });

        new events.Rule(this, "ScanCompletedWsRule", {
            eventBus,
            ruleName: `${prefix}-scan-completed-ws`,
            eventPattern: {
                source:     ["costscrunch.receipts"],
                detailType: ["ReceiptScanCompleted"],
            },
            targets: [new targets.LambdaFunction(wsNotifierLambda, {
                deadLetterQueue: wsNotifierDlq,
                maxEventAge:     Duration.hours(1),
                retryAttempts:   2,
            })],
        });

        new events.Rule(this, "ExpenseApprovedRule", {
            eventBus,
            eventPattern: {
                source:     ["costscrunch.expenses"],
                detailType: ["ExpenseStatusChanged"],
                detail:     { status: ["approved", "rejected"] },
            },
            targets: [new targets.LambdaFunction(notificationsLambda)],
        });

        // ── WAF Access Logs ──────────────────────────────────────────────
        // CloudFront-scoped WebACLs require logs in us-east-1.
        // If this stack is deployed outside us-east-1, move this LogGroup to a
        // separate us-east-1 stack and reference its ARN cross-stack.
        const wafLogGroup = new logs.LogGroup(this, "WafLogGroup", {
            logGroupName: `/aws/wafv2/${prefix}-waf-logs`,
            retention: logs.RetentionDays.THREE_MONTHS,
            removalPolicy,
        });

        // ── WAF v2 WebACL ─────────────────────────────────────────────────
        const wafAcl = new wafv2.CfnWebACL(this, "WafAcl", {
            name: `${prefix}-waf`,
            scope: "CLOUDFRONT",
            defaultAction: { allow: {} },
            description: "CloudFront WAF: managed rules + rate limiting",
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: isTest ? "TestWafMetric" : `${prefix.replace(/[^a-zA-Z0-9]/g, '')}WafMetric`,
                sampledRequestsEnabled: true,
            },
            rules: [
                {
                    name: "AWSManagedRulesCommonRuleSet",
                    priority: 1,
                    overrideAction: { none: {} },
                    visibilityConfig: { 
                        cloudWatchMetricsEnabled: true, 
                        metricName: "CommonRuleSet", 
                        sampledRequestsEnabled: false 
                    },
                    statement: { 
                        managedRuleGroupStatement: { 
                            vendorName: "AWS", 
                            name: "AWSManagedRulesCommonRuleSet" 
                        } 
                    },
                },
                {
                    name: "AWSManagedRulesSQLiRuleSet",
                    priority: 2,
                    overrideAction: { none: {} },
                    visibilityConfig: { 
                        cloudWatchMetricsEnabled: true, 
                        metricName: "SQLiRuleSet", 
                        sampledRequestsEnabled: false 
                    },
                    statement: { 
                        managedRuleGroupStatement: { 
                            vendorName: "AWS", 
                            name: "AWSManagedRulesSQLiRuleSet" 
                        } 
                    },
                },
                {
                    name: "AWSManagedRulesKnownBadInputsRuleSet",
                    priority: 3,
                    overrideAction: { none: {} },
                    visibilityConfig: { 
                        cloudWatchMetricsEnabled: true, 
                        metricName: "BadInputs", 
                        sampledRequestsEnabled: false 
                    },
                    statement: { 
                        managedRuleGroupStatement: { 
                            vendorName: "AWS", 
                            name: "AWSManagedRulesKnownBadInputsRuleSet" 
                        } 
                    },
                },
                {
                    name: "GlobalRateLimitPerIP",
                    priority: 4,
                    action: { block: {} },
                    visibilityConfig: { 
                        cloudWatchMetricsEnabled: true, 
                        metricName: "GlobalRateLimit", 
                        sampledRequestsEnabled: true 
                    },
                    statement: { 
                        rateBasedStatement: { 
                            limit: 5000, 
                            aggregateKeyType: "IP" 
                        } 
                    },
                },
                {
                    name: "ReceiptUploadRateLimit",
                    priority: 5,
                    action: { block: {} },
                    visibilityConfig: {
                        cloudWatchMetricsEnabled: true,
                        metricName: "ReceiptUploadRateLimit",
                        sampledRequestsEnabled: true,
                    },
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
            ]
        });

        new wafv2.CfnLoggingConfiguration(this, "WafLoggingConfig", {
            logDestinationConfigs: [wafLogGroup.logGroupArn],
            redactedFields: [
                { singleHeader: { name: "Authorization" } },
            ],
            resourceArn: wafAcl.attrArn
        });


        // ── API Gateway HTTP API ─────────────────────────────────────────────────
        const authorizer = new apigwv2Authorizers.HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
            authorizerName: `${prefix}-authorizer`,
            identitySource: ["$request.header.Authorization"],
        });

        // ── CORS — single source of truth (mirrored in server.ts for local dev) ─────
        const CORS_ALLOW_ORIGINS = isProd ? [viteAppUrl] : ["*"];
        const CORS_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
        const CORS_ALLOW_HEADERS = ["Authorization", "Content-Type", "X-Idempotency-Key"];

        const api = new apigwv2.HttpApi(this, "Api", {
            apiName: `${prefix}-api`,
            corsPreflight: {
                allowOrigins: CORS_ALLOW_ORIGINS,
                allowMethods: CORS_ALLOW_METHODS.map(m =>
                    apigwv2.CorsHttpMethod[m as keyof typeof apigwv2.CorsHttpMethod]
                ),
                allowHeaders: CORS_ALLOW_HEADERS,
                maxAge: Duration.hours(24),
            }
        });

        // Helper to add authenticated routes
        const addRoute = (method: apigwv2.HttpMethod, path: string, fn: lambda.Function) => {
            // Use a stable ID that doesn't involve potential token interpolation
            const integrationId = `${fn.node.id}${method}Integration`;
            api.addRoutes({
                path, methods: [method],
                integration: new apigwv2Integrations.HttpLambdaIntegration(integrationId, fn),
                authorizer,
            });
        };

        // Expense routes
        addRoute(apigwv2.HttpMethod.GET, "/expenses", expensesLambda);
        addRoute(apigwv2.HttpMethod.GET, "/expenses/export", expensesLambda);
        addRoute(apigwv2.HttpMethod.POST, "/expenses", expensesLambda);
        addRoute(apigwv2.HttpMethod.GET, "/expenses/{id}", expensesLambda);
        addRoute(apigwv2.HttpMethod.PATCH, "/expenses/{id}", expensesLambda);
        addRoute(apigwv2.HttpMethod.DELETE, "/expenses/{id}", expensesLambda);

        // Group routes
        addRoute(apigwv2.HttpMethod.GET, "/groups", groupsLambda);
        addRoute(apigwv2.HttpMethod.POST, "/groups", groupsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/groups/{id}", groupsLambda);
        addRoute(apigwv2.HttpMethod.PATCH, "/groups/{id}", groupsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/groups/{id}/balances", groupsLambda);
        addRoute(apigwv2.HttpMethod.POST, "/groups/{id}/members", groupsLambda);
        addRoute(apigwv2.HttpMethod.DELETE, "/groups/{id}/members/{userId}", groupsLambda);

        // Receipt upload
        addRoute(apigwv2.HttpMethod.POST, "/receipts/upload-url", receiptsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/receipts/{expenseId}/scan", receiptsLambda);

        // Analytics
        addRoute(apigwv2.HttpMethod.GET, "/analytics/summary", analyticsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/analytics/trends", analyticsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/analytics/chartData", analyticsLambda);
        addRoute(apigwv2.HttpMethod.GET, "/health", healthLambda);

        // ── CloudFront Response Headers Policy (CORS for all /api/* responses) ──────
        // Adds CORS headers at the CDN layer — covers 4XX/5XX errors from API GW
        // that never reach Lambda, making per-handler CORS headers unnecessary.
        const corsHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'CorsPolicy', {
            responseHeadersPolicyName: `${prefix}-cors`, 
            comment: 'Add CORS headers at CDN layer',
            corsBehavior: {
                accessControlAllowOrigins: CORS_ALLOW_ORIGINS,
                // Critical fix: Allow custom headers (Authorization, etc.) at the edge
                accessControlAllowHeaders: CORS_ALLOW_HEADERS,
                accessControlAllowMethods: CORS_ALLOW_METHODS,
                accessControlExposeHeaders: CORS_ALLOW_HEADERS,
                accessControlAllowCredentials: false,
                accessControlMaxAge: Duration.seconds(86400),
                originOverride: true
            }
        });

        // ── CloudFront Distribution ──────────────────────────────────────────────
        const distribution = new cloudfront.Distribution(this, "CfDistribution", {
            comment: `${prefix} CDN`,
            defaultBehavior: {
                origin: new origins.S3Origin(assetsBucket),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
            },
            additionalBehaviors: {
                "/api/*": {
                origin: new origins.HttpOrigin(
                    (isTest || cdk.Token.isUnresolved(api.apiId))
                        ? `dummy.execute-api.${regionId}.amazonaws.com` 
                        : `${api.apiId}.execute-api.${regionId}.amazonaws.com`
                ),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                responseHeadersPolicy: corsHeadersPolicy,
                },
            },
            webAclId: wafAcl.attrArn,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
            });

        // ── Security Guard: block MOCK_AUTH in non-dev environments ──────────────
        // OWASP ASVS v4.0 V13.1 — fail synthesis if any Lambda has MOCK_AUTH set
        // outside dev. This catches accidental env-var injection in the CDK stack
        // even though MOCK_AUTH is currently only set via SAM/LocalStack locally.
        if (environment !== "dev") {
            Annotations.of(this).addInfo(
                `Scanning all Lambda functions for MOCK_AUTH env-var (stage=${environment})`
            );
            Aspects.of(this).add({
                visit(node: IConstruct) {
                    if (node instanceof lambda.Function) {
                        const fnEnv = (node as any).environment as Record<string, string> | undefined;
                        if (fnEnv && "MOCK_AUTH" in fnEnv) {
                            Annotations.of(node).addError(
                                `MOCK_AUTH environment variable found on ${node.node.path}. ` +
                                `Mock authentication bypasses MUST NOT be deployed to ${environment}. ` +
                                "Remove MOCK_AUTH from this function's environment. " +
                                "See OWASP ASVS v4.0 control V13.1."
                            );
                        }
                    }
                },
            });
        }

        // ── Security Guard: Enforce Encryption ──────────────────────────────────
        // Ensure all S3 Buckets and DynamoDB Tables use KMS encryption.
        Aspects.of(this).add(new EncryptionEnforcementAspect());

        // ── Security Guard: No Secrets in Environment Variables ──────────────────
        // OWASP ASVS v4.0 V13.1 — fail synthesis if sensitive values appear as
        // plain text env vars. Use SSM Parameter Store or Secrets Manager instead.
        Aspects.of(this).add({
            visit(node: IConstruct) {
                if (node instanceof lambda.Function) {
                    const fnEnv = (node as any).environment as Record<string, string> | undefined;
                    if (!fnEnv) return;

                    // Patterns that indicate hardcoded secrets (case-insensitive)
                    const SENSITIVE_PATTERNS = [
                        /^(api[_-]?key|secret|password|token|credential)/i,
                        /^(aws[_-]??(access[_-]?key|secret))/i,
                        /^(bearer|auth[_-]?token)/i,
                        /@costscrunch\.(com|io|dev)$/,  // Email patterns
                    ];

                    for (const [key, value] of Object.entries(fnEnv)) {
                        // Skip SSM parameter path references (these are safe)
                        if (key.startsWith("SSM_") || key.startsWith("SECRET_")) continue;

                        // Check for sensitive key names
                        if (SENSITIVE_PATTERNS.some(p => p.test(key))) {
                            Annotations.of(node).addError(
                                `Sensitive env var '${key}' found on ${node.node.path}. ` +
                                "Store secrets in SSM Parameter Store or Secrets Manager. " +
                                "See OWASP ASVS v4.0 control V13.1."
                            );
                        }

                        // Check for email patterns in values (but not SSM paths)
                        if (!key.startsWith("SSM_") && !key.startsWith("SECRET_")) {
                            if (/@costscrunch\.(com|io|dev)$/.test(value)) {
                                Annotations.of(node).addError(
                                    `Email-like value detected in env var '${key}' on ${node.node.path}. ` +
                                    "Move to Secrets Manager."
                                );
                            }
                        }
                    }
                }
            },
        });

        // ── Outputs ───────────────────────────────────────────────────────────────
        new CfnOutput(this, "ApiUrl", { value: (api.url && !cdk.Token.isUnresolved(api.url)) ? api.url : "https://dummy-api.com", exportName: `${prefix}-api-url` });
        new CfnOutput(this, "CdnUrl", { value: `https://${distribution.distributionDomainName}`, exportName: `${prefix}-cdn-url` });
        new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId, exportName: `${prefix}-user-pool-id` });
        new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId, exportName: `${prefix}-client-id` });
        new CfnOutput(this, "TableName", { value: table.tableName, exportName: `${prefix}-table` });
        new CfnOutput(this, "UploadsBucketOut", { value: uploadsBucket.bucketName, exportName: `${prefix}-uploads-bucket` });
        new CfnOutput(this, "ProcessedBucketOut", { value: processedBucket.bucketName, exportName: `${prefix}-processed-bucket` });
        new CfnOutput(this, "ReceiptsBucketOut", { value: receiptsBucket.bucketName, exportName: `${prefix}-receipts-bucket` });
        new CfnOutput(this, "WsApiUrl",       { value: wsStage.url,               exportName: `${prefix}-ws-url` });
        new CfnOutput(this, "ConnTableName",  { value: connTable.tableName,        exportName: `${prefix}-conn-table` });
        new CfnOutput(this, "TextractTopicArn", { value: textractTopic.topicArn,  exportName: `${prefix}-textract-topic` });

        // ── CloudWatch Alarms & SNS Alerts ──────────────────────────────────────
        const alarmsTopic = new sns.Topic(this, "AlarmsTopic", {
            topicName: `${prefix}-alarms`,
            masterKey: kmsKey,
        });

        const alarmAction = new cw_actions.SnsAction(alarmsTopic);

        // 1. Lambda Error Rate & Duration Alarms
        // List of functions with their specific timeout for threshold calculation
        const lambdaMonitoring = [
            { fn: expensesLambda, timeout: 29 },
            { fn: groupsLambda, timeout: 29 },
            { fn: healthLambda, timeout: 29 },
            { fn: imagePreprocessLambda, timeout: 60 },
            { fn: receiptsLambda, timeout: 29 },
            { fn: analyticsLambda, timeout: 29 },
            { fn: notificationsLambda, timeout: 29 },
            { fn: snsWebhookLambda, timeout: 29 },
            { fn: wsNotifierLambda, timeout: 29 }
        ];

        const errorRateThreshold = alarmThreshold.errorRate;

        lambdaMonitoring.forEach(({ fn, timeout }) => {
            // Error Rate Alarm (> 5% over 5m)
            const errors = fn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" });
            const invocations = fn.metricInvocations({ period: Duration.minutes(5), statistic: "Sum" });

            const errorRateAlarm = new cloudwatch.MathExpression({
                expression: "100 * (errors / invocations)",
                usingMetrics: { errors, invocations },
                label: `${fn.node.id} Error Rate`,
            }).createAlarm(this, `${fn.node.id}ErrorRateAlarm`, {
                threshold: errorRateThreshold,
                evaluationPeriods: 3,
                datapointsToAlarm: 3,
                alarmDescription: `Error rate for ${fn.node.id} is > ${errorRateThreshold}% over 5 minutes`,
                treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            errorRateAlarm.addAlarmAction(alarmAction);

            // Duration Alarm (> alarmThreshold.durationP99)
            const durationAlarm = fn.metricDuration({
                period: Duration.minutes(5),
                statistic: "p99",
            }).createAlarm(this, `${fn.node.id}DurationAlarm`, {
                threshold: alarmThreshold.durationP99,
                evaluationPeriods: 1,
                alarmDescription: `Duration for ${fn.node.id} is > ${alarmThreshold.durationP99}ms P99`,
            });
            durationAlarm.addAlarmAction(alarmAction);
        });

        // 3. DynamoDB ThrottledRequests > 0
        const throttledAlarm = new cloudwatch.Alarm(this, "DynamoThrottledAlarm", {
            metric: table.metric("ThrottledRequests", {
                period: Duration.minutes(5),
                statistic: "Sum",
            }),
            threshold: 0,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarmDescription: "DynamoDB main table is throttling requests",
        });
        throttledAlarm.addAlarmAction(alarmAction);

        // 4. Custom Metric for Textract/SNS Pipeline Failures
        // Filter log group of snsWebhookLambda for explicit error patterns
        const textractFailureFilter = new logs.MetricFilter(this, "TextractFailureFilter", {
            logGroup: snsWebhookLambda.logGroup,
            metricNamespace: "CostsCrunch/Pipeline",
            metricName: "TextractFailures",
            filterPattern: logs.FilterPattern.anyTerm("ERROR", "Failed to get expense analysis", "Textract error"),
            metricValue: "1",
        });

        const pipelineAlarm = textractFailureFilter.metric({ period: Duration.minutes(5), statistic: "Sum" })
            .createAlarm(this, "TextractPipelineAlarm", {
                threshold: 1,
                evaluationPeriods: 1,
                alarmDescription: "Detected Textract or SNS webhook pipeline failures in logs",
            });
        pipelineAlarm.addAlarmAction(alarmAction);

        // 5. DLQ Message Count > 0
        const dlqAlarm = new cloudwatch.Alarm(this, "ScanDlqAlarm", {
            metric: scanDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Sum" }),
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            alarmDescription: "Messages found in receipt processing DLQ",
        });
        dlqAlarm.addAlarmAction(alarmAction);

        new CfnOutput(this, "AlarmsTopicArn", {
            value: alarmsTopic.topicArn,
            exportName: `${prefix}-alarms-topic-arn`,
        });
    }
}

/**
 * CDK Aspect that ensures S3 Buckets and DynamoDB Tables have encryption configured.
 */
import { IAspect } from "aws-cdk-lib";
import { StackConfig } from "./StackConfig";

class EncryptionEnforcementAspect implements IAspect {
    public visit(node: IConstruct): void {
        // Only check L1 constructs (CfnBucket, CfnTable) for explicit encryption config
        if (node instanceof s3.CfnBucket) {
            const encryption = node.bucketEncryption;
            if (!encryption) {
                Annotations.of(node).addError("S3 Bucket must have encryption configured.");
            }
        }
        if (node instanceof dynamodb.CfnTable) {
            const sse = node.sseSpecification;
            if (!sse || (sse as any).sseEnabled === false) {
                Annotations.of(node).addError("DynamoDB Table must have SSE encryption enabled.");
            }
        }
    }
}
