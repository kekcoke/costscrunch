// ─── CostsCrunch — AWS CDK Infrastructure Stack (Orchestrator) ──────────────────
// Instantiates service constructs, wires cross-construct IAM grants,
// event sources, Cognito trigger, EventBridge rules, and CfnOutputs.

import * as cdk from "aws-cdk-lib";
import { Stack, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

import { buildStackConfig } from "./StackConfig";
import { ConfigConstruct } from "./constructs/ConfigConstruct";
import { NetworkConstruct } from "./constructs/NetworkConstruct";
import { DataConstruct } from "./constructs/DataConstruct";
import { StorageConstruct } from "./constructs/StorageConstruct";
import { CognitoConstruct } from "./constructs/CognitoConstruct";
import { MessagingConstruct } from "./constructs/MessagingConstruct";
import { ComputeConstruct } from "./constructs/ComputeConstruct";
import { ApiConstruct } from "./constructs/ApiConstruct";
import { EdgeConstruct } from "./constructs/EdgeConstruct";
import { ObservabilityConstruct } from "./constructs/ObservabilityConstruct";
import { applySecurityAspects } from "./constructs/SecurityAspects";
import { CostsCrunchStackProps } from "./CostsCrunchStackProps";

export interface AlarmThreshold {
  errorRate: number;
  durationP99: number;
}

export class CostsCrunchStack extends Stack {
  constructor(scope: Construct, id: string, props: CostsCrunchStackProps) {
    super(scope, id, props);

    const { environment } = props;
    const isProd      = environment === "prod";
    const isStaging   = environment === "staging";
    const prefix      = `costscrunch-${environment}`;

    const capacityMode = props.capacityMode ?? (isProd ? "provisioned" : "on-demand");
    const alarmThreshold = props.alarmThreshold ?? {
      errorRate:   isProd ? 1 : isStaging ? 3 : 5,
      durationP99: isProd ? 10000 : isStaging ? 20000 : 30000,
    };
    const useProvisionedConcurrency = props.provisionedConcurrency ?? isProd;
    const removalPolicy = props.removalPolicy === "retain"
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const config = props.config ?? buildStackConfig(this, this.account, this.region);
    const { accountId, regionId, isTest } = config;

    // ── Foundation ───────────────────────────────────────────────────────────────
    const kmsKey = new kms.Key(this, "CostsCrunchKey", {
      alias:             `${prefix}-main`,
      enableKeyRotation: true,
      description:       "Primary KMS encryption key",
      removalPolicy,
    });

    // ── Service Constructs (bottom-up dependency order) ───────────────────────────
    const cfg = new ConfigConstruct(this, "Config", { prefix, isProd });

    const network = new NetworkConstruct(this, "Network", { prefix, isProd });

    const data = new DataConstruct(this, "Data", {
      prefix, isProd, kmsKey, capacityMode, removalPolicy,
    });

    const storage = new StorageConstruct(this, "Storage", {
      prefix, isProd, accountId, kmsKey,
      viteAppUrl: cfg.viteAppUrl,
      removalPolicy,
    });

    const auth = new CognitoConstruct(this, "Cognito", {
      prefix, isProd,
      viteAppUrl: cfg.viteAppUrl,
      removalPolicy,
    });

    const messaging = new MessagingConstruct(this, "Messaging", { prefix, kmsKey });

    // AWSLambdaPowertoolsTypeScriptV2 layer version (published by AWS to account
    // 094274105915 in each region). AWS periodically releases new versions —
    // override per-deploy via `-c powertoolsLayerVersion=<n>` instead of
    // editing ComputeConstruct.ts. See:
    // https://docs.aws.amazon.com/powertools/typescript/latest/getting-started/lambda-layers/
    const powertoolsLayerVersion = Number(
      this.node.tryGetContext("powertoolsLayerVersion") ?? 22,
    );

    const compute = new ComputeConstruct(this, "Compute", {
      prefix, isProd, environment, regionId, powertoolsLayerVersion,
      vpc:          network.vpc,
      lambdaSg:     network.lambdaSg,
      redis:        network.redis,
      table:        data.table,
      connTable:    data.connTable,
      uploadsBucket:    storage.uploadsBucket,
      processedBucket:  storage.processedBucket,
      receiptsBucket:   storage.receiptsBucket,
      assetsBucket:     storage.assetsBucket,
      quarantineBucket: storage.quarantineBucket,
      eventBus:         messaging.eventBus,
      textractTopic:    messaging.textractTopic,
      textractSnsRole:  messaging.textractSnsRole,
      scanQueue:        messaging.scanQueue,
      userPool:         auth.userPool,
      userPoolClient:   auth.userPoolClient,
      bedrockModelIdParam: cfg.bedrockModelIdParam,
      viteAppUrlParam:     cfg.viteAppUrlParam,
      notificationSecret:  cfg.notificationSecret,
    });

    const api = new ApiConstruct(this, "Api", {
      prefix, isProd,
      viteAppUrl: cfg.viteAppUrl,
      userPool:   auth.userPool,
      compute,
      config,
    });

    const edge = new EdgeConstruct(this, "Edge", {
      prefix, isProd, isTest, environment, regionId,
      viteAppUrl:  cfg.viteAppUrl,
      assetsBucket: storage.assetsBucket,
      httpApi:      api.httpApi,
      removalPolicy,
    });

    const alarmEmail = this.node.tryGetContext("alarmEmail") as string | undefined;
    const obs = new ObservabilityConstruct(this, "Obs", {
      prefix, alarmThreshold, kmsKey,
      compute,
      table:            data.table,
      scanDlq:          messaging.scanDlq,
      notificationsDlq: messaging.notificationsDlq,
      wsNotifierDlq:    messaging.wsNotifierDlq,
      alarmEmail,
    });

    // ── Deferred env injection ────────────────────────────────────────────────────
    // wsStage.callbackUrl is a CDK token that resolves at synth; inject after ApiConstruct.
    compute.wsNotifierLambda.addEnvironment("WEBSOCKET_ENDPOINT", api.wsCallbackUrl);
    compute.imagePreprocessLambda.addEnvironment("WEBSOCKET_ENDPOINT", api.wsCallbackUrl);

    // ── IAM Grants (all cross-construct grants in one place) ──────────────────────
    // DynamoDB — main table
    data.table.grantReadWriteData(compute.expensesLambda);
    data.table.grantReadWriteData(compute.groupsLambda);
    data.table.grantReadWriteData(compute.receiptsLambda);
    data.table.grantReadWriteData(compute.snsWebhookLambda);
    data.table.grantReadData(compute.analyticsLambda);
    data.table.grantReadWriteData(compute.profileLambda);
    data.table.grantReadWriteData(compute.notificationsLambda);
    data.table.grantReadWriteData(compute.authTriggerLambda);
    data.table.grantReadData(compute.expenseExportLambda);

    // DynamoDB — connections table
    data.connTable.grantReadWriteData(compute.wsNotifierLambda);
    data.connTable.grantReadWriteData(compute.wsHandlerLambda);

    // S3
    storage.uploadsBucket.grantRead(compute.imagePreprocessLambda);
    storage.processedBucket.grantPut(compute.imagePreprocessLambda);
    compute.imagePreprocessLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["s3:PutObject"],
      resources: [`${storage.quarantineBucket.attrArn}/*`],
    }));
    storage.assetsBucket.grantPut(compute.expenseExportLambda);
    storage.processedBucket.grantPut(compute.receiptsLambda);
    storage.receiptsBucket.grantRead(compute.snsWebhookLambda);
    storage.receiptsBucket.grantRead(compute.receiptsLambda);

    // WebSocket @connections
    compute.wsNotifierLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["execute-api:ManageConnections"],
      resources: [`arn:aws:execute-api:${regionId}:${accountId}:*/prod/POST/@connections/*`],
    }));

    // EventBridge
    messaging.eventBus.grantPutEventsTo(compute.snsWebhookLambda);
    messaging.eventBus.grantPutEventsTo(compute.expensesLambda);

    // Textract
    compute.receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["textract:StartExpenseAnalysis"],
      resources: ["*"],
    }));
    compute.receiptsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["iam:PassRole"],
      resources: [messaging.textractSnsRole.roleArn],
    }));
    compute.snsWebhookLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["textract:GetExpenseAnalysis"],
      resources: ["*"],
    }));

    // Bedrock
    compute.snsWebhookLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${regionId}::foundation-model/${compute.bedrockModelName}`],
    }));

    // KMS
    [
      compute.expensesLambda,
      compute.imagePreprocessLambda,
      compute.receiptsLambda,
      compute.snsWebhookLambda,
      compute.groupsLambda,
      compute.profileLambda,
      compute.wsNotifierLambda,
      compute.authTriggerLambda,
      compute.expenseExportLambda,
    ].forEach(fn => kmsKey.grantEncryptDecrypt(fn));

    // SSM
    cfg.bedrockModelIdParam.grantRead(compute.snsWebhookLambda);

    // Secrets Manager
    cfg.notificationSecret.grantRead(compute.notificationsLambda);

    // SES + Pinpoint
    compute.notificationsLambda.addToRolePolicy(new iam.PolicyStatement({
      actions:   ["ses:SendEmail", "ses:SendTemplatedEmail", "mobiletargeting:SendMessages"],
      resources: ["*"],
    }));

    // X-Ray
    const xrayPolicy = new iam.PolicyStatement({
      actions:   ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      resources: ["*"],
    });
    [compute.imagePreprocessLambda, compute.receiptsLambda, compute.snsWebhookLambda, compute.wsNotifierLambda]
      .forEach(fn => fn.addToRolePolicy(xrayPolicy));

    // ── S3 Event Sources ──────────────────────────────────────────────────────────
    compute.imagePreprocessLambda.addEventSource(new lambdaEventSources.S3EventSource(
      storage.uploadsBucket as s3.Bucket,
      { events: [s3.EventType.OBJECT_CREATED], filters: [{ prefix: "uploads/" }] },
    ));
    compute.receiptsLambda.addEventSource(new lambdaEventSources.S3EventSource(
      storage.processedBucket as s3.Bucket,
      { events: [s3.EventType.OBJECT_CREATED], filters: [{ prefix: "receipts/" }] },
    ));

    // ── SNS → SQS → Lambda (Textract pipeline) ────────────────────────────────────
    messaging.textractTopic.addSubscription(new sns_subscriptions.SqsSubscription(messaging.scanQueue));
    compute.snsWebhookLambda.addEventSource(new lambdaEventSources.SqsEventSource(messaging.scanQueue));

    // ── Cognito Post-Confirmation Trigger ─────────────────────────────────────────
    // authTriggerLambda and UserPool reference each other via ARN tokens (not constructs)
    // so there is no CDK circular dependency — the orchestrator wires both safely.
    const cfnUserPool = auth.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnUserPool.lambdaConfig = {
      postConfirmation: compute.authTriggerLambda.functionName,
    };
    compute.authTriggerLambda.addPermission("CognitoInvoke", {
      principal:  new iam.ServicePrincipal("cognito-idp.amazonaws.com"),
      sourceArn:  auth.userPool.userPoolArn,
      action:     "lambda:InvokeFunction",
    });

    // ── EventBridge Rules ─────────────────────────────────────────────────────────
    new events.Rule(this, "ScanCompletedNotifRule", {
      eventBus:     messaging.eventBus,
      ruleName:     `${prefix}-scan-completed-notif`,
      eventPattern: { source: ["costscrunch.receipts"], detailType: ["ReceiptScanCompleted"] },
      targets: [new targets.LambdaFunction(compute.notificationsLambda, {
        deadLetterQueue: messaging.notificationsDlq,
        maxEventAge:     Duration.hours(2),
        retryAttempts:   3,
      })],
    });

    new events.Rule(this, "ScanCompletedWsRule", {
      eventBus:     messaging.eventBus,
      ruleName:     `${prefix}-scan-completed-ws`,
      eventPattern: { source: ["costscrunch.receipts"], detailType: ["ReceiptScanCompleted"] },
      targets: [new targets.LambdaFunction(compute.wsNotifierLambda, {
        deadLetterQueue: messaging.wsNotifierDlq,
        maxEventAge:     Duration.hours(1),
        retryAttempts:   2,
      })],
    });

    new events.Rule(this, "ExpenseApprovedRule", {
      eventBus:     messaging.eventBus,
      eventPattern: {
        source:     ["costscrunch.expenses"],
        detailType: ["ExpenseStatusChanged"],
        detail:     { status: ["approved", "rejected"] },
      },
      targets: [new targets.LambdaFunction(compute.notificationsLambda)],
    });

    // ── Provisioned Concurrency (prod only) ───────────────────────────────────────
    if (useProvisionedConcurrency) {
      for (const fn of [compute.expensesLambda, compute.groupsLambda, compute.snsWebhookLambda]) {
        const alias   = fn.addAlias("live");
        const scaling = alias.addAutoScaling({ minCapacity: 1, maxCapacity: 10 });
        scaling.scaleOnUtilization({ utilizationTarget: 0.5 });
      }
    }

    // ── Security Aspects ──────────────────────────────────────────────────────────
    applySecurityAspects(this, environment);

    // ── Outputs ───────────────────────────────────────────────────────────────────
    new CfnOutput(this, "ApiUrl", {
      value:      (api.httpApi.url && !cdk.Token.isUnresolved(api.httpApi.url)) ? api.httpApi.url : "https://dummy-api.com",
      exportName: `${prefix}-api-url`,
    });
    new CfnOutput(this, "CdnUrl",          { value: `https://${edge.distribution.distributionDomainName}`, exportName: `${prefix}-cdn-url` });
    new CfnOutput(this, "UserPoolId",      { value: auth.userPool.userPoolId,              exportName: `${prefix}-user-pool-id` });
    new CfnOutput(this, "UserPoolClientId",{ value: auth.userPoolClient.userPoolClientId,  exportName: `${prefix}-client-id` });
    new CfnOutput(this, "TableName",       { value: data.table.tableName,                  exportName: `${prefix}-table` });
    new CfnOutput(this, "UploadsBucketOut",{ value: storage.uploadsBucket.bucketName,      exportName: `${prefix}-uploads-bucket` });
    new CfnOutput(this, "ProcessedBucketOut",{ value: storage.processedBucket.bucketName,  exportName: `${prefix}-processed-bucket` });
    new CfnOutput(this, "ReceiptsBucketOut",{ value: storage.receiptsBucket.bucketName,    exportName: `${prefix}-receipts-bucket` });
    new CfnOutput(this, "WsApiUrl",        { value: api.wsStage.url,                       exportName: `${prefix}-ws-url` });
    new CfnOutput(this, "ConnTableName",   { value: data.connTable.tableName,               exportName: `${prefix}-conn-table` });
    new CfnOutput(this, "TextractTopicArn",{ value: messaging.textractTopic.topicArn,      exportName: `${prefix}-textract-topic` });
    new CfnOutput(this, "AlarmsTopicArn",  { value: obs.alarmsTopic.topicArn,               exportName: `${prefix}-alarms-topic-arn` });
  }
}
