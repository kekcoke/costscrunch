/**
 * jest.setup.integration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs before every integration test suite.
 * Sets environment variables that the Lambda handlers read at module load time.
 */

// ─── Point all AWS SDK clients at LocalStack ──────────────────────────────────
process.env.AWS_ENDPOINT_URL        = "http://localhost:4566";
process.env.AWS_REGION              = "us-east-1"; 
process.env.AWS_REGION              = "us-east-1";
process.env.AWS_ACCESS_KEY_ID       = "test";
process.env.AWS_SECRET_ACCESS_KEY   = "test";

// ─── Lambda runtime environment variables ────────────────────────────────────
process.env.TABLE_NAME              = "costscrunch-dev-main";
process.env.BUCKET_NAME             = "costscrunch-dev-receipts-000000000000";
process.env.EVENT_BUS_NAME          = "costscrunch-dev";
process.env.FROM_EMAIL              = "noreply@costscrunch.dev.com";
process.env.POWERTOOLS_SERVICE_NAME = "test";
process.env.POWERTOOLS_METRICS_NAMESPACE = "costscrunch/Test";
process.env.POWERTOOLS_LOGGER_LOG_EVENT  = "false";

// ─── Suppress Powertools output during tests ─────────────────────────────────
process.env.LOG_LEVEL = "SILENT";