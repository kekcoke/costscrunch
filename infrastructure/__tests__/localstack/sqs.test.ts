// ─── SQS Infrastructure Tests ─────────────────────────────────────────────────
// Validates SQS queues match CostsCrunchStack.ts configuration.
// Tests queue existence, FIFO settings, and DLQ configuration.

import { describe, it, expect } from "vitest";
import {
  SQSClient,
  GetQueueAttributesCommand,
  ListQueuesCommand,
} from "@aws-sdk/client-sqs";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new SQSClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const PREFIX = "costscrunch-dev";
const QUEUE_SCAN_DLQ = `${PREFIX}-scan-dlq`;
const QUEUE_NOTIF_DLQ = `${PREFIX}-notif-dlq`;
const QUEUE_NOTIFICATIONS = `${PREFIX}-notifications.fifo`;
const QUEUE_WS_NOTIFIER_DLQ = `${PREFIX}-ws-notifier-dlq`;

async function getQueueUrl(queueName: string): Promise<string> {
  return `http://localhost:4566/000000000000/${queueName}`;
}

describe("SQS Queues", () => {
  describe("Queue Existence", () => {
    it("should have all required queues created", async () => {
      const response = await client.send(new ListQueuesCommand({}));
      const queueUrls = response.QueueUrls ?? [];

      const expectedQueues = [
        QUEUE_SCAN_DLQ,
        QUEUE_NOTIF_DLQ,
        QUEUE_NOTIFICATIONS,
        QUEUE_WS_NOTIFIER_DLQ,
      ];

      for (const expectedQueue of expectedQueues) {
        const found = queueUrls.some((url) => url.includes(expectedQueue));
        expect(found).toBe(true);
      }
    });
  });

  describe("Scan DLQ", () => {
    it("should have 14-day retention period", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_SCAN_DLQ),
          AttributeNames: ["MessageRetentionPeriod"],
        })
      );
      // 14 days = 1209600 seconds
      expect(response.Attributes?.MessageRetentionPeriod).toBe("1209600");
    });
  });

  describe("Notifications FIFO Queue", () => {
    it("should be a FIFO queue", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_NOTIFICATIONS),
          AttributeNames: ["FifoQueue"],
        })
      );
      expect(response.Attributes?.FifoQueue).toBe("true");
    });

    it("should have content-based deduplication enabled", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_NOTIFICATIONS),
          AttributeNames: ["ContentBasedDeduplication"],
        })
      );
      expect(response.Attributes?.ContentBasedDeduplication).toBe("true");
    });

    it("should have 60-second visibility timeout", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_NOTIFICATIONS),
          AttributeNames: ["VisibilityTimeout"],
        })
      );
      expect(response.Attributes?.VisibilityTimeout).toBe("60");
    });

    it("should have DLQ configured with max receive count of 3", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_NOTIFICATIONS),
          AttributeNames: ["RedrivePolicy"],
        })
      );
      const policy = JSON.parse(response.Attributes?.RedrivePolicy ?? "{}");
      expect(policy.maxReceiveCount).toBe(3);
      expect(policy.deadLetterTargetArn).toContain(QUEUE_NOTIF_DLQ);
    });
  });

  describe("Notif DLQ", () => {
    it("should have 14-day retention period", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_NOTIF_DLQ),
          AttributeNames: ["MessageRetentionPeriod"],
        })
      );
      expect(response.Attributes?.MessageRetentionPeriod).toBe("1209600");
    });
  });

  describe("WS Notifier DLQ", () => {
    it("should have 14-day retention period", async () => {
      const response = await client.send(
        new GetQueueAttributesCommand({
          QueueUrl: await getQueueUrl(QUEUE_WS_NOTIFIER_DLQ),
          AttributeNames: ["MessageRetentionPeriod"],
        })
      );
      expect(response.Attributes?.MessageRetentionPeriod).toBe("1209600");
    });
  });
});
