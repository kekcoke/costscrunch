/**
 * vitest.setup.integration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs before every integration test suite.
 * Sets environment variables that the Lambda handlers read at module load time.
 */
import "aws-sdk-client-mock-vitest/extend";
import { vi } from "vitest";
// ─── Point all AWS SDK clients at LocalStack ──────────────────────────────────
process.env.AWS_ENDPOINT_URL        = "http://localhost:4566";
process.env.AWS_REGION              = "us-east-1"; 
process.env.AWS_ACCESS_KEY_ID       = "test";
process.env.AWS_SECRET_ACCESS_KEY   = "test";

// ─── Lambda runtime environment variables ────────────────────────────────────
process.env.TABLE_NAME_MAIN         = "costscrunch-dev-main";
process.env.BUCKET_RECEIPTS_NAME    = "costscrunch-dev-receipts-000000000000";
process.env.EVENT_BUS_NAME          = "costscrunch-dev";
process.env.REDIS_HOST              = "costcrunch.elasticache.amazonaws.com"
process.env.REDIS_PORT              = "6379"
process.env.USER_POOL_ID            = "us-east-1_xxxxxxxx"
process.env.FROM_EMAIL              = "noreply@costscrunch.dev";
process.env.ENVIRONMENT             = "dev"
process.env.POWERTOOLS_SERVICE_NAME = "test";
process.env.POWERTOOLS_METRICS_NAMESPACE = "costscrunch/Test";
process.env.POWERTOOLS_LOGGER_LOG_EVENT  = "false";
process.env.BEDROCK_MODEL_ID        = "foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0";
process.env.WEBSOCKET_ENDPOINT = "wss://costscrunch.com/socket"

// ─── Suppress Powertools output during tests ─────────────────────────────────
process.env.LOG_LEVEL = "SILENT";