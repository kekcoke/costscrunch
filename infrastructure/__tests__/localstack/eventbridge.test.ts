// ─── EventBridge Infrastructure Tests ─────────────────────────────────────────
// Validates EventBridge resources match CostsCrunchStack.ts configuration.
// Tests event bus, rules, and archive.

import { describe, it, expect, beforeAll } from "vitest";
import {
  EventBridgeClient,
  DescribeEventBusCommand,
  ListRulesCommand,
  ListArchivesCommand,
} from "@aws-sdk/client-eventbridge";

const ENDPOINT = process.env.AWS_ENDPOINT_URL ?? "http://localhost:4566";

const client = new EventBridgeClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const PREFIX = "costscrunch-dev";
const EVENT_BUS_NAME = `${PREFIX}-events`;

describe("EventBridge", () => {
  describe("Event Bus", () => {
    it("should have the main event bus created", async () => {
      const response = await client.send(
        new DescribeEventBusCommand({ Name: EVENT_BUS_NAME })
      );
      expect(response.Name).toBe(EVENT_BUS_NAME);
    });
  });

  describe("Event Rules", () => {
    let rules: any[];

    beforeAll(async () => {
      const response = await client.send(
        new ListRulesCommand({ EventBusName: EVENT_BUS_NAME })
      );
      rules = response.Rules ?? [];
    });

    it("should have scan-completed-notif rule", () => {
      const rule = rules.find(
        (r) => r.Name === `${PREFIX}-scan-completed-notif`
      );
      expect(rule).toBeDefined();
      expect(rule?.State).toBe("ENABLED");
    });

    it("should have scan-completed-ws rule", () => {
      const rule = rules.find(
        (r) => r.Name === `${PREFIX}-scan-completed-ws`
      );
      expect(rule).toBeDefined();
      expect(rule?.State).toBe("ENABLED");
    });

    it("should have expense-approved rule", () => {
      const rule = rules.find(
        (r) => r.Name === `${PREFIX}-expense-approved`
      );
      expect(rule).toBeDefined();
      expect(rule?.State).toBe("ENABLED");
    });

    it("scan-completed-notif should filter by ReceiptScanCompleted", () => {
      const rule = rules.find(
        (r) => r.Name === `${PREFIX}-scan-completed-notif`
      );
      const pattern = JSON.parse(rule?.EventPattern ?? "{}");
      expect(pattern.source).toContain("costscrunch.receipts");
      expect(pattern["detail-type"]).toContain("ReceiptScanCompleted");
    });

    it("expense-approved should filter by ExpenseStatusChanged", () => {
      const rule = rules.find(
        (r) => r.Name === `${PREFIX}-expense-approved`
      );
      const pattern = JSON.parse(rule?.EventPattern ?? "{}");
      expect(pattern.source).toContain("costscrunch.expenses");
      expect(pattern["detail-type"]).toContain("ExpenseStatusChanged");
    });
  });

  describe("Event Archive", () => {
    it("should have an archive for the event bus", async () => {
      const response = await client.send(new ListArchivesCommand({}));
      const archive = response.Archives?.find(
        (a) => a.ArchiveName === `${PREFIX}-archive`
      );
      expect(archive).toBeDefined();
    });

    it("archive should have 30-day retention", async () => {
      const response = await client.send(new ListArchivesCommand({}));
      const archive = response.Archives?.find(
        (a) => a.ArchiveName === `${PREFIX}-archive`
      );
      // 30 days = 2592000 seconds
      expect(archive?.RetentionDays).toBe(30);
    });
  });
});
