// ─── CostsCrunch — Notifications Lambda ────────────────────────────────────────
// Triggered by EventBridge rules for: scan completed, expense approved/rejected,
// budget alerts, balance reminders, weekly digest

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { withErrorHandler } from "../../utils/withErrorHandler.js";
import type { EventBridgeEvent } from "aws-lambda";

const ses = new SESClient({});
const sns = new SNSClient({});
const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;
const FROM_EMAIL = process.env.FROM_EMAIL!;

const logger = new Logger({ serviceName: "notifications" });
const metrics = new Metrics({ namespace: "CostsCrunch" });

// ─── Email Templates ──────────────────────────────────────────────────────────
const templates = {
  receiptScanned: (data: any) => ({
    subject: `Receipt scanned — ${data.merchant || "Unknown merchant"}`,
    html: `
      <div style="font-family:system-ui;max-width:560px;margin:0 auto;padding:32px;background:#f8fafc">
        <div style="background:#1e293b;padding:24px;border-radius:12px;color:white;margin-bottom:20px">
          <h2 style="margin:0;color:#38bdf8">💸 CostsCrunch</h2>
        </div>
        <div style="background:white;padding:28px;border-radius:12px;border:1px solid #e2e8f0">
          <h3 style="color:#0f172a;margin-top:0">Receipt Scanned Successfully ✅</h3>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Merchant</td><td style="padding:8px 0;font-weight:600">${data.merchant || "Unknown"}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Amount</td><td style="padding:8px 0;font-weight:700;color:#0ea5e9">$${data.amount?.toFixed(2) || "—"}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Category</td><td style="padding:8px 0">${data.category || "—"}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b;font-size:14px">Confidence</td><td style="padding:8px 0">${data.confidence}%</td></tr>
          </table>
          <a href="https://app.costscrunch.io/expenses/${data.expenseId}" style="display:inline-block;margin-top:20px;background:#0ea5e9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Review & Confirm →
          </a>
        </div>
        <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:20px">
          CostsCrunch · <a href="https://app.costscrunch.io/settings/notifications" style="color:#94a3b8">Manage notifications</a>
        </p>
      </div>
    `,
  }),

  expenseStatusChanged: (data: any) => ({
    subject: `Expense ${data.status} — ${data.merchant}`,
    html: `
      <div style="font-family:system-ui;max-width:560px;margin:0 auto;padding:32px">
        <div style="background:white;padding:28px;border-radius:12px;border:1px solid #e2e8f0">
          <h3 style="margin-top:0">Expense ${data.status === "approved" ? "Approved ✅" : "Rejected ❌"}</h3>
          <p><strong>${data.merchant}</strong> for <strong>$${data.amount?.toFixed(2)}</strong> has been <strong>${data.status}</strong>.</p>
          ${data.approverNote ? `<p style="background:#f1f5f9;padding:12px;border-radius:8px;font-style:italic">"${data.approverNote}"</p>` : ""}
          <a href="https://app.costscrunch.io/expenses/${data.expenseId}" style="display:inline-block;margin-top:16px;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            View Expense →
          </a>
        </div>
      </div>
    `,
  }),

  budgetAlert: (data: any) => ({
    subject: `⚠️ Budget alert — ${data.groupName} at ${data.percentUsed}%`,
    html: `
      <div style="font-family:system-ui;max-width:560px;margin:0 auto;padding:32px">
        <div style="background:white;padding:28px;border-radius:12px;border:1px solid #fbbf24">
          <h3 style="color:#d97706;margin-top:0">⚠️ Budget Alert</h3>
          <p>The <strong>${data.groupName}</strong> group has used <strong>${data.percentUsed}%</strong> of its ${data.period} budget.</p>
          <p>Spent: <strong>$${data.spent?.toFixed(2)}</strong> of <strong>$${data.budget?.toFixed(2)}</strong></p>
          <a href="https://app.costscrunch.io/groups/${data.groupId}" style="display:inline-block;margin-top:16px;background:#f59e0b;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            View Group →
          </a>
        </div>
      </div>
    `,
  }),
};

// ─── Main Handler ─────────────────────────────────────────────────────────────
export const handler = withErrorHandler(async (event: EventBridgeEvent<string, any>) => {
  const { "detail-type": detailType, detail } = event;
  logger.info("Notification event received", { detailType, detail });

  // Fetch user preferences
  let user: any = null;
  if (detail.userId) {
    const result = await ddb.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: `USER#${detail.userId}`, sk: `PROFILE#${detail.userId}` },
    }));
    user = result.Item;
  }

  if (!user || !user.email) {
    logger.warn("User not found or no email", { userId: detail.userId });
    return;
  }

  // Check notification preferences
  if (!user.notificationPreferences?.email) {
    logger.info("Email notifications disabled for user", { userId: detail.userId });
    return;
  }

  let template: { subject: string; html: string } | null = null;

  switch (detailType) {
    case "ReceiptScanCompleted":
      template = templates.receiptScanned(detail);
      metrics.addMetric("NotifScanCompleted", MetricUnit.Count, 1);
      break;

    case "ExpenseStatusChanged":
      template = templates.expenseStatusChanged(detail);
      metrics.addMetric("NotifStatusChanged", MetricUnit.Count, 1);
      break;

    case "BudgetAlert":
      template = templates.budgetAlert(detail);
      metrics.addMetric("NotifBudgetAlert", MetricUnit.Count, 1);
      break;

    default:
      logger.warn("Unknown event type", { detailType });
      return;
  }

  if (!template) return;

  try {
    await ses.send(new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [user.email] },
      Message: {
        Subject: { Data: template.subject, Charset: "UTF-8" },
        Body: {
          Html: { Data: template.html, Charset: "UTF-8" },
        },
      },
      Tags: [
        { Name: "notificationType", Value: detailType },
        { Name: "environment", Value: process.env.ENVIRONMENT || "dev" },
      ],
    }));

    metrics.addMetric("EmailSent", MetricUnit.Count, 1);
    logger.info("Notification sent", { email: user.email, type: detailType });

    // Store notification record in DynamoDB for in-app notification center
    const now = new Date().toISOString();
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: `USER#${detail.userId}`, sk: `NOTIFICATION#${now}` },
      UpdateExpression: "SET #type = :type, #message = :msg, read = :read, createdAt = :now, #ttl = :ttl",
      ExpressionAttributeNames: { "#type": "type", "#message": "message", "#ttl": "ttl" },
      ExpressionAttributeValues: {
        ":type": detailType,
        ":msg": template.subject,
        ":read": false,
        ":now": now,
        ":ttl": Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90-day TTL
      },
    }));

  } catch (error) {
    logger.error("Failed to send notification", { error, email: user.email });
    metrics.addMetric("EmailFailed", MetricUnit.Count, 1);
    throw error; // re-throw to trigger DLQ
  }
});