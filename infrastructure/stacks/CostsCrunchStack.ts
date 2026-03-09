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
        const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0";

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
                    allowedOrigins: isProd ? [`https://app.costscrunch.com`] : ["*"],
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

        // ── EventBridge ──────────────────────────────────────────────────────────
        const eventBus = new events.EventBus(this, "EventBus", {
            eventBusName: `${prefix}-events`,
        });

        const eventArchive = new events.Archive(this, "EventArchive", {
            archiveName: `${prefix}-archive`,
            sourceEventBus: eventBus,
            retention: Duration.days(30),
            eventPattern: {
                source: ["costscrunch.expenses", "costscrunch.users", "costscrunch.billing"],
            }
        });

        // ── Lambda Layer (Powertools) ──────────────────────────────────────────────────────────
        // https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/lambda-layers/#lookup-layer-arn-via-aws-ssm-parameter-store
        const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
            this, "PowertoolsLayer",
            `arn:aws:lambda:${this.region}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:latest`
        );

        // ── Lambda Shared Environment ────────────────────────────────────────────
        const sharedEnv = {
            TABLE_NAME: table.tableName,
            EVENT_BUS_NAME: eventBus.eventBusName,
            RECEIPTS_BUCKET: receiptsBucket.bucketName,
            REDIS_HOST: redis.attrPrimaryEndPointAddress,
            REDIS_PORT: redis.attrPrimaryEndPointPort,
            USER_POOL_ID: userPool.userPoolId,
            USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
            POWERTOOLS_SERVICE_NAME: "costscrunch",
            LOG_LEVEL: isProd ? "INFO" : "DEBUG",
            ENVIRONMENT: environment,
        };

        const sharedLambdaProps: Partial<lambda.FunctionProps> = {
            runtime: lambda.Runtime.NODEJS_20_X,
            memorySize: 1024,
            timeout: Duration.seconds(29),
            tracing: lambda.Tracing.ACTIVE,
            layers: [powertoolsLayer],
            vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            logRetention: isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
            reservedConcurrentExecutions: isProd ? 500 : 50,
            environment: sharedEnv,
        };

        // ── Lambda Functions ─────────────────────────────────────────────────────
        const expensesLambda = new NodejsFunction(this, "ExpensesLambda", {
            ...sharedLambdaProps as any,
            entry: "backend/src/lambdas/expenses/index.ts",
            functionName: `${prefix}-expenses`,
            environment: { ...sharedEnv },
        });

        const groupsLambda = new NodejsFunction(this, "GroupsLambda", {
            ...sharedLambdaProps as any,
            entry: "backend/src/lambdas/groups/index.ts",
            functionName: `${prefix}-groups`,
            environment: { ...sharedEnv },
        });

        const receiptsLambda = new NodejsFunction(this, "ReceiptsLambda", {
            ...sharedLambdaProps as any,
            entry: "backend/src/lambdas/receipts/index.ts",
            functionName: `${prefix}-receipts`,
            timeout: Duration.seconds(300), // Textract can take time
            memorySize: 1024,
            environment: { ...sharedEnv },
        });

        const analyticsLambda = new NodejsFunction(this, "AnalyticsLambda", {
            ...sharedLambdaProps as any,
            entry: "backend/src/lambdas/analytics/index.ts",
            functionName: `${prefix}-analytics`,
            environment: { ...sharedEnv },
        });

        const notificationsLambda = new NodejsFunction(this, "NotificationsLambda", {
            ...sharedLambdaProps as any,
            entry: "backend/src/lambdas/notifications/index.ts",
            functionName: `${prefix}-notifications`,
            environment: {
                ...sharedEnv,
                FROM_EMAIL: "noreply@costscrunch.com",
                PINPOINT_APP_ID: ssm.StringParameter.valueForStringParameter(this, `/${prefix}/pinpoint-app-id`),
            },
        });

        // ── IAM Permissions ──────────────────────────────────────────────────────
        table.grantReadWriteData(expensesLambda);
        table.grantReadWriteData(groupsLambda);
        table.grantReadWriteData(receiptsLambda);
        table.grantReadData(analyticsLambda);
        table.grantReadWriteData(notificationsLambda);

        receiptsBucket.grantRead(receiptsLambda);
        receiptsBucket.grantWrite(expensesLambda); // for pre-signed URL generation
        eventBus.grantPutEventsTo(receiptsLambda);
        eventBus.grantPutEventsTo(expensesLambda);

        // Textract permissions for receipts Lambda
        receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["textract:StartExpenseAnalysis", "textract:GetExpenseAnalysis"],
            resources: ["*"],
        }));

        // Bedrock permissions for AI enrichment
        receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["bedrock:InvokeModel"],
            resources: [`arn:aws:bedrock:${this.region}::${BEDROCK_MODEL_ID}`],
        }));

        // KMS permissions
        kmsKey.grantEncryptDecrypt(expensesLambda);
        kmsKey.grantEncryptDecrypt(receiptsLambda);
        kmsKey.grantEncryptDecrypt(groupsLambda);

        // Notifications Lambda: SES + Pinpoint
        notificationsLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ["ses:SendEmail", "ses:SendTemplatedEmail", "mobiletargeting:SendMessages"],
            resources: ["*"],
        }));

        // ── S3 → Lambda Event Source (receipt scanning) ──────────────────────────
        receiptsLambda.addEventSource(new lambdaEventSources.S3EventSource(receiptsBucket, {
            events: [s3.EventType.OBJECT_CREATED],
            filters: [{ prefix: "receipts/" }],
        }));

        // ── EventBridge → Notifications Lambda ───────────────────────────────────
        new events.Rule(this, "ScanCompletedRule", {
            eventBus,
            eventPattern: {
                source: ["costscrunch.receipts"],
                detailType: ["ReceiptScanCompleted"],
            },
            targets: [new targets.LambdaFunction(notificationsLambda, {
                deadLetterQueue: notificationsDlq,
                maxEventAge: Duration.hours(2),
                retryAttempts: 3,
            })],
        });

        new events.Rule(this, "ExpenseApprovedRule", {
            eventBus,
            eventPattern: {
                source: ["costscrunch.expenses"],
                detailType: ["ExpenseStatusChanged"],
                detail: { status: ["approved", "rejected"] },
            },
            targets: [new targets.LambdaFunction(notificationsLambda)],
        });

        // ── WAF ─────────────────────────────────────────────────
        const wafAcl = new wafv2.CfnWebACL(this, "WafAcl", {
            name: `${prefix}-waf`,
            scope: "CLOUDFRONT",
            defaultAction: { allow: {} },
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${prefix}-waf-metric`,
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
                    name: "AWSManagedRulesKnownBadInputsRuleSet",
                    priority: 2,
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
                    name: "RateLimitPerIP",
                    priority: 3,
                    action: { block: {} },
                    visibilityConfig: { 
                        cloudWatchMetricsEnabled: true, 
                        metricName: "RateLimit", 
                        sampledRequestsEnabled: true 
                    },
                    statement: { 
                        rateBasedStatement: { 
                            limit: 2000, 
                            aggregateKeyType: "IP" 
                        } 
                    },
                },
            ]
        });

        // ── API Gateway HTTP API ─────────────────────────────────────────────────
        const authorizer = new apigwv2Authorizers.HttpUserPoolAuthorizer("CognitoAuthorizer", userPool, {
            authorizerName: `${prefix}-authorizer`,
            identitySource: ["$request.header.Authorization"],
        });

        const api = new apigwv2.HttpApi(this, "Api", {
            apiName: `${prefix}-api`,
            corsPreflight: {
                allowOrigins: isProd ? [`https://app.costscrunch.com`] : ["*"],
                allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.PUT, apigwv2.CorsHttpMethod.DELETE],
                allowHeaders: ["Authorization", "Content-Type", "X-Idempotency-Key"],
                maxAge: Duration.hours(24),
            }
        });

        // Helper to add authenticated routes
        const addRoute = (method: apigwv2.HttpMethod, path: string, fn: lambda.Function) => {
            api.addRoutes({
                path, methods: [method],
                integration: new apigwv2Integrations.HttpLambdaIntegration(`${fn.functionName}-${method}`, fn),
                authorizer,
            });
        };

        // Expense routes
        addRoute(apigwv2.HttpMethod.GET, "/expenses", expensesLambda);
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
                origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.amazonaws.com`),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                },
            },
            webAclId: wafAcl.attrArn,
            minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
            });

        // ── Outputs ───────────────────────────────────────────────────────────────
        new CfnOutput(this, "ApiUrl", { value: api.url!, exportName: `${prefix}-api-url` });
        new CfnOutput(this, "CdnUrl", { value: `https://${distribution.distributionDomainName}`, exportName: `${prefix}-cdn-url` });
        new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId, exportName: `${prefix}-user-pool-id` });
        new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId, exportName: `${prefix}-client-id` });
        new CfnOutput(this, "TableName", { value: table.tableName, exportName: `${prefix}-table` });
        new CfnOutput(this, "ReceiptsBucket", { value: receiptsBucket.bucketName, exportName: `${prefix}-receipts-bucket` })
    }
}
