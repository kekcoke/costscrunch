import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const sqs = new SQSClient({});
const sns = new SNSClient({});

const DLQ_URL = process.env.SCAN_DLQ_URL;
const TARGET_SNS_TOPIC = process.env.TEXTRACT_SNS_TOPIC_ARN;

// ─── DLQ RETRY ──────────────────
// DLQ to receive messages and retry publishing to SNS topic.
// If successful deletes message from DLQ. 
// Handler will reprocess until all queue returns nil messages.
async function reprocess() {
  if (!DLQ_URL) throw new Error("DLQ_URL environment variable is required");

  console.log(`🔍 Reading from DLQ: ${DLQ_URL}`);

  const { Messages } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: DLQ_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 5
  }));

  if (!Messages || Messages.length === 0) {
    console.log("✅ No messages found in DLQ.");
    return;
  }

  for (const msg of Messages) {
    try {
      const body = JSON.parse(msg.Body || "{}");
      // SNS-over-SQS messages have the SNS payload in the 'Message' field
      const innerMessage = JSON.parse(body.Message || "{}");
      
      console.log(`📦 Reprocessing Receipt: ${innerMessage.JobTag || "unknown"}`);
      console.log(`❌ Error Context: ${body.Error || "N/A"}`);

      if (TARGET_SNS_TOPIC) {
        console.log(`🔁 Replaying to SNS: ${TARGET_SNS_TOPIC}`);
        await sns.send(new PublishCommand({
          TopicArn: TARGET_SNS_TOPIC,
          Message: body.Message
        }));
        
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: DLQ_URL,
          ReceiptHandle: msg.ReceiptHandle!
        }));
        console.log("✅ Replayed and deleted from DLQ.");
      }
    } catch (err) {
      console.error("Failed to process DLQ message:", err);
    }
  }
}

reprocess().catch(console.error);
