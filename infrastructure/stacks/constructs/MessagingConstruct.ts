import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as kms from "aws-cdk-lib/aws-kms";

export interface MessagingConstructProps {
  prefix: string;
  kmsKey: kms.IKey;
}

export class MessagingConstruct extends Construct {
  public readonly scanDlq: sqs.Queue;
  public readonly scanQueue: sqs.Queue;
  public readonly notificationsDlq: sqs.Queue;
  public readonly notificationsQueue: sqs.Queue;
  public readonly wsNotifierDlq: sqs.Queue;
  public readonly textractTopic: sns.Topic;
  public readonly textractSnsRole: iam.Role;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: MessagingConstructProps) {
    super(scope, id);
    const { prefix, kmsKey } = props;

    const createDlq = (dlqId: string, name: string) =>
      new sqs.Queue(this, dlqId, {
        queueName: `${prefix}-${name}`,
        retentionPeriod: Duration.days(14),
        encryption: sqs.QueueEncryption.KMS,
        encryptionMasterKey: kmsKey,
      });

    this.scanDlq = createDlq("ScanDlq", "scan-dlq");

    this.scanQueue = new sqs.Queue(this, "ScanQueue", {
      queueName: `${prefix}-scan-queue`,
      visibilityTimeout: Duration.seconds(120),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey,
      deadLetterQueue: { queue: this.scanDlq, maxReceiveCount: 3 },
    });

    this.notificationsDlq = createDlq("NotifDlq", "notif-dlq");

    this.notificationsQueue = new sqs.Queue(this, "NotifQueue", {
      queueName: `${prefix}-notifications.fifo`,
      fifo: true,
      contentBasedDeduplication: true,
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: this.notificationsDlq, maxReceiveCount: 3 },
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: kmsKey,
    });

    this.wsNotifierDlq = createDlq("WsNotifierDlq", "ws-notifier-dlq");

    // Textract publishes job-completion notifications here; sns-webhook Lambda subscribes.
    this.textractTopic = new sns.Topic(this, "TextractTopic", {
      topicName:   `${prefix}-textract-completion`,
      masterKey:   kmsKey,
      displayName: "Textract async job completion",
    });

    this.textractSnsRole = new iam.Role(this, "TextractSnsRole", {
      roleName:  `${prefix}-textract-sns`,
      assumedBy: new iam.ServicePrincipal("textract.amazonaws.com"),
    });
    this.textractTopic.grantPublish(this.textractSnsRole);

    this.eventBus = new events.EventBus(this, "EventBus", {
      eventBusName: `${prefix}-events`,
    });

    new events.Archive(this, "EventArchive", {
      archiveName:     `${prefix}-archive`,
      sourceEventBus: this.eventBus,
      retention:       Duration.days(30),
      eventPattern: {
        source: [
          "costscrunch.expenses",
          "costscrunch.users",
          "costscrunch.billing",
          "costscrunch.receipts",
        ],
      },
    });
  }
}
