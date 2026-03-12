// ─── SNS Infrastructure Tests ──────────────────────────────────────────────────
// Validates SNS topics match CostsCrunchStack.ts configuration.
// Tests topic existence for Textract completion notifications.

import { describe, it, expect } from "vitest";
import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
} from "@aws-sdk/client-sns";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new SNSClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const PREFIX = "costscrunch-dev";
const TOPIC_TEXTRACT = `${PREFIX}-textract-completion`;

describe("SNS Topics", () => {
  describe("Topic Existence", () => {
    it("should have textract-completion topic created", async () => {
      const response = await client.send(new ListTopicsCommand({}));
      const topicArns = response.Topics?.map((t) => t.TopicArn) ?? [];
      const found = topicArns.some((arn) => arn?.includes(TOPIC_TEXTRACT));
      expect(found).toBe(true);
    });
  });

  describe("Textract Topic Configuration", () => {
    it("should have correct topic name in ARN", async () => {
      const response = await client.send(new ListTopicsCommand({}));
      const topic = response.Topics?.find((t) =>
        t.TopicArn?.includes(TOPIC_TEXTRACT)
      );
      expect(topic?.TopicArn).toContain(TOPIC_TEXTRACT);
    });

    it("should have topic in correct region", async () => {
      const response = await client.send(new ListTopicsCommand({}));
      const topic = response.Topics?.find((t) =>
        t.TopicArn?.includes(TOPIC_TEXTRACT)
      );
      // LocalStack uses us-east-1 by default
      expect(topic?.TopicArn).toContain("us-east-1");
    });
  });
});
