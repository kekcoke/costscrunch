import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as elasticache from "aws-cdk-lib/aws-elasticache";
import { NodejsFunction, NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";

export interface ComputeConstructProps {
  prefix: string;
  isProd: boolean;
  environment: string;
  regionId: string;
  // AWSLambdaPowertoolsTypeScriptV2 layer version published by AWS to account
  // 094274105915 in each supported region. AWS periodically publishes new
  // versions; bump via CDK context (`-c powertoolsLayerVersion=<n>`) rather
  // than editing this construct. See CostsCrunchStack.ts for the default.
  powertoolsLayerVersion: number;
  // Network
  vpc: ec2.IVpc;
  lambdaSg: ec2.ISecurityGroup;
  redis: elasticache.CfnReplicationGroup;
  // Data
  table: dynamodb.TableV2;
  connTable: dynamodb.TableV2;
  // Storage
  uploadsBucket: s3.IBucket;
  processedBucket: s3.IBucket;
  receiptsBucket: s3.IBucket;
  assetsBucket: s3.IBucket;
  quarantineBucket: s3.CfnBucket;
  // Messaging
  eventBus: events.EventBus;
  textractTopic: sns.Topic;
  textractSnsRole: iam.Role;
  scanQueue: sqs.Queue;
  // Auth
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  // Config
  bedrockModelIdParam: ssm.StringParameter;
  viteAppUrlParam: ssm.StringParameter;
  notificationSecret: secretsmanager.Secret;
}

export class ComputeConstruct extends Construct {
  public readonly expensesLambda: NodejsFunction;
  public readonly groupsLambda: NodejsFunction;
  public readonly healthLambda: NodejsFunction;
  public readonly imagePreprocessLambda: NodejsFunction;
  public readonly receiptsLambda: NodejsFunction;
  public readonly analyticsLambda: NodejsFunction;
  public readonly profileLambda: NodejsFunction;
  public readonly notificationsLambda: NodejsFunction;
  public readonly snsWebhookLambda: NodejsFunction;
  public readonly wsNotifierLambda: NodejsFunction;
  public readonly authTriggerLambda: NodejsFunction;
  public readonly authLambda: NodejsFunction;
  public readonly expenseExportLambda: NodejsFunction;
  public readonly wsHandlerLambda: NodejsFunction;
  // Bedrock model name for IAM policy ARN construction in the orchestrator.
  public readonly bedrockModelName: string;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);
    const {
      prefix, isProd, environment, regionId, powertoolsLayerVersion,
      vpc, lambdaSg, redis,
      table, connTable,
      uploadsBucket, processedBucket, receiptsBucket, assetsBucket, quarantineBucket,
      eventBus, textractTopic, textractSnsRole, scanQueue,
      userPool, userPoolClient,
      bedrockModelIdParam, viteAppUrlParam, notificationSecret,
    } = props;

    // https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/lambda-layers/
    // Layer version is configurable (default set in CostsCrunchStack.ts) since AWS
    // periodically publishes new Powertools versions and this account ID
    // (094274105915) is AWS's own published-layer account, not ours — only the
    // version number should ever change here.
    const powertoolsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this, "PowertoolsLayer",
      `arn:aws:lambda:${regionId}:094274105915:layer:AWSLambdaPowertoolsTypeScriptV2:${powertoolsLayerVersion}`,
    );

    // NOTE: Sensitive values (model IDs, emails) are NOT stored here.
    // Lambdas retrieve them at runtime via SSM/Secrets Manager.
    const sharedEnv: Record<string, string> = {
      AWS_XRAY_SDK_ENABLED:    "true",
      AWS_XRAY_TRACING_NAME:   `${prefix}-receipt-pipeline`,
      AWS_XRAY_SAMPLING_RATE:  process.env.XRAY_SAMPLING_RATE ?? "0.01",
      TABLE_NAME_MAIN:         table.tableName,
      TABLE_NAME_CONNECTIONS:  connTable.tableName,
      EVENT_BUS_NAME:          eventBus.eventBusName,
      BUCKET_UPLOADS_NAME:     uploadsBucket.bucketName,
      BUCKET_PROCESSED_NAME:   processedBucket.bucketName,
      BUCKET_RECEIPTS_NAME:    receiptsBucket.bucketName,
      BUCKET_QUARANTINE_NAME:  quarantineBucket.bucketName!,
      BUCKET_ASSETS_NAME:      assetsBucket.bucketName,
      REDIS_HOST:              redis.attrPrimaryEndPointAddress,
      REDIS_PORT:              redis.attrPrimaryEndPointPort,
      POWERTOOLS_SERVICE_NAME: "costscrunch",
      LOG_LEVEL:               isProd ? "INFO" : "DEBUG",
      ENVIRONMENT:             environment,
      AWS_REGION_ID:           regionId,
      BEDROCK_REGION:          regionId,
      SSM_BEDROCK_MODEL_ID:    bedrockModelIdParam.parameterName,
      SSM_VITE_APP_URL:        viteAppUrlParam.parameterName,
      SECRET_NOTIFICATION_ARN: notificationSecret.secretArn,
    };

    const sharedLambdaProps: Partial<NodejsFunctionProps> = {
      runtime:          lambda.Runtime.NODEJS_20_X,
      memorySize:       1024,
      timeout:          Duration.seconds(29),
      tracing:          lambda.Tracing.ACTIVE,
      layers:           [powertoolsLayer],
      bundling: {
        externalModules: [
          "@aws-lambda-powertools/logger",
          "@aws-lambda-powertools/metrics",
          "@aws-lambda-powertools/tracer",
        ],
      },
      vpc,
      vpcSubnets:       { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups:   [lambdaSg],
      logRetention:     isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_WEEK,
      reservedConcurrentExecutions: isProd ? 500 : 50,
      environment:      sharedEnv,
    };

    const lambdaDir = path.resolve(__dirname, "../../../backend/src/lambdas");

    // Helper: create a Lambda with shared defaults; overrides (incl. environment) win via spread.
    const mkFn = (constructId: string, fnName: string, entry: string, overrides: Partial<NodejsFunctionProps> = {}) =>
      new NodejsFunction(this, constructId, {
        ...(sharedLambdaProps as any),
        entry:        path.join(lambdaDir, entry),
        functionName: `${prefix}-${fnName}`,
        environment:  { ...sharedEnv },
        ...overrides,
      });

    this.expensesLambda      = mkFn("ExpensesLambda",      "expenses",      "expenses/index.ts");
    this.groupsLambda        = mkFn("GroupsLambda",        "groups",        "groups/index.ts");
    this.healthLambda        = mkFn("HealthLambda",        "health",        "health/index.ts");
    this.analyticsLambda     = mkFn("AnalyticsLambda",     "analytics",     "analytics/index.ts");
    this.profileLambda       = mkFn("ProfileLambda",       "profile",       "profile/index.ts");
    this.expenseExportLambda = mkFn("ExpenseExportLambda", "expense-export", "expense-export/index.ts");
    this.notificationsLambda = mkFn("NotificationsLambda", "notifications", "notifications/index.ts");
    this.wsNotifierLambda    = mkFn("WsNotifierLambda",    "ws-notifier",   "web-socket-notifier/index.ts");
    // WEBSOCKET_ENDPOINT injected by the orchestrator after ApiConstruct is created.

    this.imagePreprocessLambda = mkFn("ImagePreprocessLambda", "image-preprocess", "image-preprocess/index.ts", {
      memorySize: 2048,
      timeout:    Duration.seconds(60),
    });

    this.receiptsLambda = mkFn("ReceiptsLambda", "receipts", "receipts/index.ts", {
      environment: {
        ...sharedEnv,
        TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
        TEXTRACT_ROLE_ARN:      textractSnsRole.roleArn,
      },
    });

    this.snsWebhookLambda = mkFn("SnsWebhookLambda", "sns-webhook", "sns-webhook/index.ts", {
      environment: {
        ...sharedEnv,
        TEXTRACT_SNS_TOPIC_ARN: textractTopic.topicArn,
        TEXTRACT_ROLE_ARN:      textractSnsRole.roleArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.authTriggerLambda = mkFn("AuthTriggerLambda", "auth-trigger", "auth-trigger/post-confirmation.ts", {
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.authLambda = mkFn("AuthLambda", "auth", "auth/index.ts", {
      environment: {
        ...sharedEnv,
        USER_POOL_ID:        userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    this.wsHandlerLambda = mkFn("WsHandlerLambda", "ws-handler", "web-socket-handler/index.ts");

    const bedrockModelId = bedrockModelIdParam.stringValue;
    this.bedrockModelName = bedrockModelId.split("/").pop() ?? "claude-haiku";
  }
}
