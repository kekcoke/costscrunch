/**
 * jest.setup.unit.ts
 * Sets env vars for unit tests (no LocalStack needed — SDK is mocked).
 */
process.env.TABLE_NAME          = "test-table";
process.env.BUCKET_NAME         = "test-bucket";
process.env.EVENT_BUS_NAME      = "test-bus";
process.env.FROM_EMAIL          = "noreply@test.com";
process.env.AWS_DEFAULT_REGION  = "us-east-1";
process.env.AWS_ACCESS_KEY_ID   = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";
process.env.POWERTOOLS_SERVICE_NAME = "test";
process.env.POWERTOOLS_METRICS_NAMESPACE = "Costscrunch/Test";
process.env.LOG_LEVEL           = "SILENT";
