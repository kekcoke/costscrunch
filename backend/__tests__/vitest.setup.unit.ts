/**
 * vitest.setup.unit.ts
 * Sets env vars for unit tests (no LocalStack needed — SDK is mocked).
 */
import "aws-sdk-client-mock-vitest/extend";
import { vi } from "vitest";
process.env.TABLE_NAME          = "test-table";
process.env.BUCKET_NAME         = "test-bucket";
process.env.RECEIPTS_BUCKET     = "test-receipts-bucket";
process.env.EVENT_BUS_NAME      = "test-bus";
process.env.FROM_EMAIL          = "noreply@test.com";
process.env.AWS_REGION          = "us-east-1";
process.env.AWS_ACCESS_KEY_ID   = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.POWERTOOLS_SERVICE_NAME = "test";
process.env.POWERTOOLS_METRICS_NAMESPACE = "Costscrunch/Test";
process.env.LOG_LEVEL           = "SILENT";
process.env.TEXTRACT_SNS_TOPIC_ARN = "arn:aws:sns:us-east-1:123:test-topic";
process.env.TEXTRACT_ROLE_ARN      = "arn:aws:iam::123:role/test-role";
process.env.DEBUG_EVENT        = "true"
process.env.WEBSOCKET_ENDPOINT = "wss://costscrunch.com/socket"