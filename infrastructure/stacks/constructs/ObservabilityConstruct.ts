import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { AlarmThreshold } from "../CostsCrunchStack";
import { ComputeConstruct } from "./ComputeConstruct";

export interface ObservabilityConstructProps {
  prefix: string;
  alarmThreshold: AlarmThreshold;
  kmsKey: kms.IKey;
  compute: ComputeConstruct;
  table: dynamodb.TableV2;
  scanDlq: sqs.Queue;
  notificationsDlq: sqs.Queue;
  wsNotifierDlq: sqs.Queue;
  // Optional email for alarm subscriptions (CDK context: alarmEmail)
  alarmEmail?: string;
}

export class ObservabilityConstruct extends Construct {
  public readonly alarmsTopic: sns.Topic;
  public readonly alarmAction: cw_actions.SnsAction;

  constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);
    const {
      prefix, alarmThreshold, kmsKey,
      compute, table, scanDlq, notificationsDlq, wsNotifierDlq, alarmEmail,
    } = props;

    this.alarmsTopic = new sns.Topic(this, "AlarmsTopic", {
      topicName: `${prefix}-alarms`,
      masterKey:  kmsKey,
    });

    if (alarmEmail) {
      this.alarmsTopic.addSubscription(new sns_subscriptions.EmailSubscription(alarmEmail));
    }

    this.alarmAction = new cw_actions.SnsAction(this.alarmsTopic);

    const lambdaMonitoring: Array<{ fn: NodejsFunction; timeout: number }> = [
      { fn: compute.expensesLambda,       timeout: 29 },
      { fn: compute.groupsLambda,         timeout: 29 },
      { fn: compute.healthLambda,         timeout: 29 },
      { fn: compute.imagePreprocessLambda, timeout: 60 },
      { fn: compute.receiptsLambda,       timeout: 29 },
      { fn: compute.analyticsLambda,      timeout: 29 },
      { fn: compute.profileLambda,        timeout: 29 },
      { fn: compute.notificationsLambda,  timeout: 29 },
      { fn: compute.snsWebhookLambda,     timeout: 29 },
      { fn: compute.wsNotifierLambda,     timeout: 29 },
      { fn: compute.authTriggerLambda,    timeout: 29 },
      { fn: compute.authLambda,           timeout: 29 },
      { fn: compute.expenseExportLambda,  timeout: 29 },
      { fn: compute.wsHandlerLambda,      timeout: 29 },
    ];

    const errorRateThreshold = alarmThreshold.errorRate;

    lambdaMonitoring.forEach(({ fn }) => {
      const errors      = fn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" });
      const invocations = fn.metricInvocations({ period: Duration.minutes(5), statistic: "Sum" });

      const errorRateAlarm = new cloudwatch.MathExpression({
        expression: "100 * (errors / invocations)",
        usingMetrics: { errors, invocations },
        label: `${fn.node.id} Error Rate`,
      }).createAlarm(this, `${fn.node.id}ErrorRateAlarm`, {
        threshold:          errorRateThreshold,
        evaluationPeriods:  3,
        datapointsToAlarm:  3,
        alarmDescription:   `Error rate for ${fn.node.id} is > ${errorRateThreshold}% over 5 minutes`,
        treatMissingData:   cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      errorRateAlarm.addAlarmAction(this.alarmAction);

      const durationAlarm = fn.metricDuration({ period: Duration.minutes(5), statistic: "p99" })
        .createAlarm(this, `${fn.node.id}DurationAlarm`, {
          threshold:         alarmThreshold.durationP99,
          evaluationPeriods: 1,
          alarmDescription:  `Duration for ${fn.node.id} is > ${alarmThreshold.durationP99}ms P99`,
        });
      durationAlarm.addAlarmAction(this.alarmAction);
    });

    // DynamoDB throttling
    const throttledAlarm = new cloudwatch.Alarm(this, "DynamoThrottledAlarm", {
      metric: table.metric("ThrottledRequests", { period: Duration.minutes(5), statistic: "Sum" }),
      threshold:           0,
      evaluationPeriods:   1,
      comparisonOperator:  cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription:    "DynamoDB main table is throttling requests",
    });
    throttledAlarm.addAlarmAction(this.alarmAction);

    // Textract/SNS pipeline failure metric from logs
    const textractFailureFilter = new logs.MetricFilter(this, "TextractFailureFilter", {
      logGroup:         compute.snsWebhookLambda.logGroup,
      metricNamespace:  "CostsCrunch/Pipeline",
      metricName:       "TextractFailures",
      filterPattern:    logs.FilterPattern.anyTerm("ERROR", "Failed to get expense analysis", "Textract error"),
      metricValue:      "1",
    });

    const pipelineAlarm = textractFailureFilter.metric({ period: Duration.minutes(5), statistic: "Sum" })
      .createAlarm(this, "TextractPipelineAlarm", {
        threshold:         1,
        evaluationPeriods: 1,
        alarmDescription:  "Detected Textract or SNS webhook pipeline failures in logs",
      });
    pipelineAlarm.addAlarmAction(this.alarmAction);

    // DLQ alarms
    const dlqAlarm = new cloudwatch.Alarm(this, "ScanDlqAlarm", {
      metric: scanDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold:          1,
      evaluationPeriods:  1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription:   "Messages found in receipt processing DLQ",
    });
    dlqAlarm.addAlarmAction(this.alarmAction);

    new cloudwatch.Alarm(this, "NotifDlqAlarm", {
      metric:            notificationsDlq.metricApproximateNumberOfMessagesVisible(),
      threshold:         1,
      evaluationPeriods: 1,
      alarmDescription:  "notifDlq has unprocessed messages",
    }).addAlarmAction(new cw_actions.SnsAction(this.alarmsTopic));

    new cloudwatch.Alarm(this, "WsNotifierDlqAlarm", {
      metric:            wsNotifierDlq.metricApproximateNumberOfMessagesVisible(),
      threshold:         1,
      evaluationPeriods: 1,
      alarmDescription:  "wsNotifierDlq has unprocessed messages",
    }).addAlarmAction(new cw_actions.SnsAction(this.alarmsTopic));
  }
}
