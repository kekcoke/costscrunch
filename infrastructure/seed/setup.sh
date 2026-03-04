#!/usr/bin/env bash
# ─── Costscrunch — LocalStack Resource Seed ────────────────────────────────────
# Runs once after LocalStack is healthy.
# Creates: DynamoDB table + GSIs, S3 bucket, SES identity, SQS queues, SNS topics, EventBridge bus

set -euo pipefail

AWS="aws --endpoint-url=http://localstack:4566 --region us-east-1"
TABLE="costscrunch-dev-main"
BUCKET_RECEIPTS="costscrunch-dev-receipts-000000000000"
BUCKET_ASSETS="costscrunch-dev-assets-000000000000"
EVENT_BUS="costscrunch-dev-events"
PREFIX="costscrunch-dev"

echo "🔧 costscrunch LocalStack seed starting..."

# ── KMS (stub) ────────────────────────────────────────────────────────────────
# LocalStack free tier returns a valid key ARN; alias mirrors CDK alias/${prefix}-main
echo "📦 Creating KMS key"
KMS_KEY_ID=$($AWS kms create-key \
  --description "Primary KMS encryption key (local stub)" \
  --no-cli-pager 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['KeyMetadata']['KeyId'])" 2>/dev/null || echo "local-kms-key")

$AWS kms create-alias \
  --alias-name "alias/${PREFIX}-main" \
  --target-key-id "$KMS_KEY_ID" \
  --no-cli-pager 2>/dev/null || echo "  ↳ KMS alias already exists, skipping"

echo "✅ KMS ready (key: $KMS_KEY_ID)"

# ── DynamoDB ──────────────────────────────────────────────────────────────────
echo "📦 Creating DynamoDB table: $TABLE"
$AWS dynamodb create-table \
  --table-name "$TABLE" \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
    AttributeName=gsi2pk,AttributeType=S \
    AttributeName=gsi2sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --global-secondary-indexes \
    '[
      {
        "IndexName": "GSI1",
        "KeySchema": [{"AttributeName":"gsi1pk","KeyType":"HASH"},{"AttributeName":"gsi1sk","KeyType":"RANGE"}],
        "Projection": {"ProjectionType":"ALL"}
      },
      {
        "IndexName": "GSI2",
        "KeySchema": [{"AttributeName":"gsi2pk","KeyType":"HASH"},{"AttributeName":"gsi2sk","KeyType":"RANGE"}],
        "Projection": {"ProjectionType":"ALL"}
      }
    ]' \
  --billing-mode PAY_PER_REQUEST \
  --no-cli-pager 2>/dev/null || echo "  ↳ Table already exists, skipping"

# Enable TTL (attribute name: ttl — matches CDK timeToLiveAttribute)
$AWS dynamodb update-time-to-live \
  --table-name "$TABLE" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --no-cli-pager 2>/dev/null || true

# Enable point-in-time recovery (matches CDK pointInTimeRecovery: true)
$AWS dynamodb update-continuous-backups \
  --table-name "$TABLE" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --no-cli-pager 2>/dev/null || true

echo "✅ DynamoDB ready"

# ── S3 — Receipts Bucket ──────────────────────────────────────────────────────
echo "📦 Creating S3 receipts bucket: $BUCKET_RECEIPTS"
$AWS s3api create-bucket \
  --bucket "$BUCKET_RECEIPTS" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

# Enable versioning (matches CDK versioned: true)
$AWS s3api put-bucket-versioning \
  --bucket "$BUCKET_RECEIPTS" \
  --versioning-configuration Status=Enabled \
  --no-cli-pager 2>/dev/null || true

# CORS: PUT + GET only, localhost:3000 only (matches CDK — no HEAD, no :5173)
$AWS s3api put-bucket-cors \
  --bucket "$BUCKET_RECEIPTS" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT","GET"],
      "AllowedOrigins": ["http://localhost:3000"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# Lifecycle: transition to INTELLIGENT_TIERING after 30d; expire after 365d (matches CDK)
$AWS s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_RECEIPTS" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "intelligent-tiering",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "Transitions": [{"Days": 30, "StorageClass": "INTELLIGENT_TIERING"}]
      },
      {
        "ID": "expiration",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "Expiration": {"Days": 365},
        "NoncurrentVersionExpiration": {"NoncurrentDays": 90}
      }
    ]
  }' \
  --no-cli-pager 2>/dev/null || true

echo "✅ Receipts bucket ready"

# ── SES ───────────────────────────────────────────────────────────────────────
echo "📦 Verifying SES email identity"
$AWS ses verify-email-identity \
  --email-address "noreply@costscrunch.dev" \
  --no-cli-pager 2>/dev/null || true
echo "✅ SES ready"

# ── EventBridge ───────────────────────────────────────────────────────────────
echo "📦 Creating EventBridge bus: $EVENT_BUS"
$AWS events create-event-bus \
  --name "$EVENT_BUS" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bus already exists, skipping"
echo "✅ EventBridge ready"

# ── SQS ───────────────────────────────────────────────────────────────────────
echo "📦 Creating SQS queues"
$AWS sqs create-queue \
  --queue-name "costscrunch-dev-notifications.fifo" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --no-cli-pager 2>/dev/null || true

$AWS sqs create-queue \
  --queue-name "costscrunch-dev-notifications-dlq.fifo" \
  --attributes FifoQueue=true,ContentBasedDeduplication=true \
  --no-cli-pager 2>/dev/null || true
echo "✅ SQS ready"

# ── SNS ───────────────────────────────────────────────────────────────────────
echo "📦 Creating SNS topic"
$AWS sns create-topic \
  --name "costscrunch-dev-notifications" \
  --no-cli-pager 2>/dev/null || true
echo "✅ SNS ready"

# ── SSM Parameters ────────────────────────────────────────────────────────────
echo "📦 Writing SSM parameters"
$AWS ssm put-parameter \
  --name "/costscrunch/dev/table-name" \
  --value "$TABLE" \
  --type String \
  --overwrite \
  --no-cli-pager 2>/dev/null || true

$AWS ssm put-parameter \
  --name "/costscrunch/dev/receipts-bucket" \
  --value "$BUCKET" \
  --type String \
  --overwrite \
  --no-cli-pager 2>/dev/null || true
echo "✅ SSM ready"

# ── Seed test data ────────────────────────────────────────────────────────────
echo "📦 Seeding test user + sample expenses"
$AWS dynamodb put-item \
  --table-name "$TABLE" \
  --item '{
    "pk":        {"S": "USER#test-user-001"},
    "sk":        {"S": "PROFILE#test-user-001"},
    "gsi1pk":    {"S": "EMAIL#test@costscrunch.dev"},
    "gsi1sk":    {"S": "USER#test-user-001"},
    "entityType":{"S": "USER"},
    "userId":    {"S": "test-user-001"},
    "email":     {"S": "test@costscrunch.dev"},
    "name":      {"S": "Test User"},
    "currency":  {"S": "USD"},
    "timezone":  {"S": "America/New_York"},
    "locale":    {"S": "en-US"},
    "plan":      {"S": "pro"},
    "notificationPrefs": {"M": {
      "email":           {"BOOL": true},
      "push":            {"BOOL": false},
      "sms":             {"BOOL": false},
      "digestFrequency": {"S": "weekly"}
    }},
    "createdAt":    {"S": "2026-01-01T00:00:00.000Z"},
    "updatedAt":    {"S": "2026-01-01T00:00:00.000Z"},
    "lastActiveAt": {"S": "2026-01-01T00:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

echo ""
echo "✅✅✅ LocalStack seed complete! Resources available at http://localhost:4566"
echo ""
echo "Useful commands:"
echo "  List tables:  aws --endpoint-url=http://localhost:4566 dynamodb list-tables"
echo "  List buckets: aws --endpoint-url=http://localhost:4566 s3 ls"
echo "  Scan table:   aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name $TABLE"