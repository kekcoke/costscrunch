#!/usr/bin/env bash
# ─── Costscrunch — LocalStack Resource Seed ────────────────────────────────────
# Runs once after LocalStack is healthy.
# Mirrors infrastructure defined in CostsCrunchStack.ts
#
# Requires: aws-cli, python3  (provided by Dockerfile.seed)
#
# Resources created:
#   KMS key + alias, DynamoDB tables (main + connections) + GSIs + TTL + PITR + encryption,
#   S3 buckets (receipts + assets) + encryption + CORS + lifecycle,
#   Cognito MOCK — DynamoDB-backed substitute (Cognito is paid-tier only),
#   SQS queues (scan-dlq, notif-dlq, notifications.fifo, ws-notifier-dlq),
#   SNS topics (textract-completion, alarms), EventBridge bus + rules + archive,
#   SSM parameters (including WS endpoint + Textract topic ARN), seed test data
#
# ── LocalStack free tier limitations relevant to this stack ──────────────────
# The following services used in CostsCrunchStack.ts are NOT available on the
# free tier and are either stubbed or omitted entirely in this seed:
#
#   Cognito          — paid tier only; replaced with DynamoDB mock (see below)
#   ElastiCache      — paid tier only; Redis stubbed via SSM placeholders
#   Textract         — paid tier only; receipt scanning won't function locally
#   WAFv2            — CRUD accepted but rules are NOT enforced (no-op)
#   CloudFront       — basic distribution CRUD only; no real CDN behaviour
#   Bedrock          — paid tier only; AI enrichment in receipts Lambda won't run
#   Pinpoint         — paid tier only; push/SMS notifications won't fire
#   API GW WebSocket — basic WS CRUD accepted; @connections push is a no-op locally
#   IAM enforcement  — policies accepted but NOT enforced on free tier
#   Persistence      — free tier has no durable state; seed must re-run on restart

set -euo pipefail

# Load environment variables: .env -> .env.<ENVIRONMENT> -> .env.local
# ENV_FILES=("../../../.env" "../../../.env.${ENVIRONMENT:-dev}" "../../../.env.local")
# for f in "${ENV_FILES[@]}"; do
#   if [ -f "$f" ]; then
#     echo "  ↳ Sourcing $f"
#     export $(grep -v '^#' "$f" | xargs)
#   fi
# done

AWS="aws --endpoint-url=http://localstack:4566 --region us-east-1"
TABLE_NAME_MAIN="costscrunch-dev-main"
TABLE_NAME_DYNAMO_CONNECTIONS="costscrunch-dev-connections"
BUCKET_UPLOADS_NAME="costscrunch-dev-uploads-000000000000"
BUCKET_PROCESSED_NAME="costscrunch-dev-processed-000000000000"
BUCKET_RECEIPTS_NAME="costscrunch-dev-receipts-000000000000"
BUCKET_ASSETS="costscrunch-dev-assets-000000000000"
EVENT_BUS_NAME="costscrunch-dev-events"
PREFIX="costscrunch-dev"
FROM_EMAIL="noreply@costscrunch.dev"
# Accept connections from both opt2 (port 4566 proxy) and opt3 (port 3001)
APP_URL="${APP_URL:-http://localhost:3000}"
APP_URL_OPT3="http://localhost:3001"
APP_URL_VITE="http://localhost:5173"

echo "🔧 costscrunch LocalStack seed starting..."

# ── KMS ───────────────────────────────────────────────────────────────────────
echo "📦 Creating KMS key"
KMS_KEY_ID=$($AWS kms create-key \
  --description "Primary KMS encryption key (local stub)" \
  --no-cli-pager \
  --query 'KeyMetadata.KeyId' \
  --output text)

$AWS kms create-alias \
  --alias-name "alias/${PREFIX}-main" \
  --target-key-id "$KMS_KEY_ID" \
  --no-cli-pager 2>/dev/null || echo "  ↳ KMS alias already exists, skipping"

echo "✅ KMS ready (key: $KMS_KEY_ID)"

# ── DynamoDB ──────────────────────────────────────────────────────────────────
echo "📦 Creating DynamoDB table: $TABLE_NAME_MAIN"
$AWS dynamodb create-table \
  --table-name "$TABLE_NAME_MAIN" \
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
  --table-name "$TABLE_NAME_MAIN" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --no-cli-pager 2>/dev/null || true

# Enable point-in-time recovery (matches CDK pointInTimeRecovery: true)
$AWS dynamodb update-continuous-backups \
  --table-name "$TABLE_NAME_MAIN" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --no-cli-pager 2>/dev/null || true

# Enable SSE encryption with KMS (matches CDK TableEncryptionV2.customerManagedKey)
$AWS dynamodb update-table \
  --table-name "$TABLE_NAME_MAIN" \
  --sse-specification "Enabled=true,SSEType=KMS,KMSMasterKeyId=$KMS_KEY_ID" \
  --no-cli-pager 2>/dev/null || true

echo "✅ DynamoDB main table ready"

# ── DynamoDB — WebSocket Connection Table ────────────────────────────────────
echo "📦 Creating DynamoDB connections table: $TABLE_NAME_DYNAMO_CONNECTIONS"
$AWS dynamodb create-table \
  --table-name "$TABLE_NAME_DYNAMO_CONNECTIONS" \
  --attribute-definitions \
    AttributeName=pk,AttributeType=S \
    AttributeName=sk,AttributeType=S \
  --key-schema \
    AttributeName=pk,KeyType=HASH \
    AttributeName=sk,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --no-cli-pager 2>/dev/null || echo "  ↳ Connections table already exists, skipping"

$AWS dynamodb update-time-to-live \
  --table-name "$TABLE_NAME_DYNAMO_CONNECTIONS" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" \
  --no-cli-pager 2>/dev/null || true

# Enable SSE encryption with KMS (matches CDK TableEncryptionV2.customerManagedKey)
$AWS dynamodb update-table \
  --table-name "$TABLE_NAME_DYNAMO_CONNECTIONS" \
  --sse-specification "Enabled=true,SSEType=KMS,KMSMasterKeyId=$KMS_KEY_ID" \
  --no-cli-pager 2>/dev/null || true

echo "✅ DynamoDB connections table ready"

# ── S3 — Uploads Bucket (initial user uploads) ──────────────────────────────────
echo "📦 Creating S3 uploads bucket: $BUCKET_UPLOADS_NAME"
$AWS s3api create-bucket \
  --bucket "$BUCKET_UPLOADS_NAME" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

# NO versioning (matches CDK versioned: false) - temporary uploads bucket

# Enable bucket encryption with KMS (matches CDK BucketEncryption.KMS_MANAGED)
$AWS s3api put-bucket-encryption \
  --bucket "$BUCKET_UPLOADS_NAME" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms"
      }
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# CORS: PUT + GET only, origin from APP_URL (matches CDK dev mode "*")
$AWS s3api put-bucket-cors \
  --bucket "$BUCKET_UPLOADS_NAME" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT","GET"],
      "AllowedOrigins": ["'"$APP_URL"'", "'"$APP_URL_OPT3"'", "'"$APP_URL_VITE"'"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# Lifecycle: expire after 7 days (matches CDK - auto-delete after processing)
$AWS s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_UPLOADS_NAME" \
  --lifecycle-configuration '{
    "Rules": [
      {
        "ID": "auto-expire",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "Expiration": {"Days": 7}
      }
    ]
  }' \
  --no-cli-pager 2>/dev/null || true

echo "✅ Uploads bucket ready"

# ── S3 — Processed Bucket (compressed images) ────────────────────────────────────
echo "📦 Creating S3 processed bucket: $BUCKET_PROCESSED_NAME"
$AWS s3api create-bucket \
  --bucket "$BUCKET_PROCESSED_NAME" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

# Enable versioning (matches CDK versioned: true)
$AWS s3api put-bucket-versioning \
  --bucket "$BUCKET_PROCESSED_NAME" \
  --versioning-configuration Status=Enabled \
  --no-cli-pager 2>/dev/null || true

# Enable bucket encryption with KMS (matches CDK BucketEncryption.KMS_MANAGED)
$AWS s3api put-bucket-encryption \
  --bucket "$BUCKET_PROCESSED_NAME" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms"
      }
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# Lifecycle: transition to INTELLIGENT_TIERING after 30d; expire after 365d (matches CDK)
$AWS s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_PROCESSED_NAME" \
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

echo "✅ Processed bucket ready"

# ── S3 — Receipts Bucket ──────────────────────────────────────────────────────
echo "📦 Creating S3 receipts bucket: $BUCKET_RECEIPTS_NAME"
$AWS s3api create-bucket \
  --bucket "$BUCKET_RECEIPTS_NAME" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

# Enable versioning (matches CDK versioned: true)
$AWS s3api put-bucket-versioning \
  --bucket "$BUCKET_RECEIPTS_NAME" \
  --versioning-configuration Status=Enabled \
  --no-cli-pager 2>/dev/null || true

# Enable bucket encryption with KMS (matches CDK BucketEncryption.KMS_MANAGED)
$AWS s3api put-bucket-encryption \
  --bucket "$BUCKET_RECEIPTS_NAME" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms"
      }
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# CORS: PUT + GET only, origin from APP_URL (matches CDK dev mode "*")
$AWS s3api put-bucket-cors \
  --bucket "$BUCKET_RECEIPTS_NAME" \
  --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["PUT","GET"],
      "AllowedOrigins": ["'"$APP_URL"'", "'"$APP_URL_OPT3"'", "'"$APP_URL_VITE"'"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

# Lifecycle: transition to INTELLIGENT_TIERING after 30d; expire after 365d (matches CDK)
$AWS s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET_RECEIPTS_NAME" \
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

# ── S3 — Assets Bucket ───────────────────────────────────────────────────────
echo "📦 Creating S3 assets bucket: $BUCKET_ASSETS"
$AWS s3api create-bucket \
  --bucket "$BUCKET_ASSETS" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

$AWS s3api put-public-access-block \
  --bucket "$BUCKET_ASSETS" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true \
  --no-cli-pager 2>/dev/null || true

# Enable bucket encryption (matches CDK defaults for assets bucket)
$AWS s3api put-bucket-encryption \
  --bucket "$BUCKET_ASSETS" \
  --server-side-encryption-configuration '{
    "Rules": [{
      "ApplyServerSideEncryptionByDefault": {
        "SSEAlgorithm": "aws:kms"
      }
    }]
  }' \
  --no-cli-pager 2>/dev/null || true

echo "✅ Assets bucket ready"

# ── Cognito MOCK ─────────────────────────────────────────────────────────────
# Cognito (cognito-idp) is a paid-tier LocalStack service.
#
# This mock stores auth state directly in the main DynamoDB table using the
# same pk/sk/GSI conventions as the rest of the app. It is intentionally
# minimal — just enough to unblock local Lambda development and seeded test
# users. It does NOT implement token issuance, SRP, or OAuth flows.
#
# Mock entity layout in DynamoDB:
#   User pool   pk=POOL#<id>          sk=POOL#<id>
#   Client      pk=POOL#<id>          sk=CLIENT#<client-id>
#   Group       pk=POOL#<id>          sk=GROUP#<name>
#   User        pk=POOL#<id>          sk=USER#<sub>
#               gsi1pk=EMAIL#<email>  gsi1sk=POOL#<id>   ← email lookup
#
# The app's Lambda code must guard Cognito calls with a MOCK_AUTH=true env
# check and read user identity from the DynamoDB mock table instead.
#
# Stable IDs so SSM values are consistent across seed re-runs.
MOCK_POOL_ID="local-pool-costscrunch-dev"
MOCK_CLIENT_ID="local-client-costscrunch-dev-web"

echo "📦 Seeding Cognito mock (DynamoDB-backed)"

# User pool record
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "POOL#'"$MOCK_POOL_ID"'"},
    "sk":         {"S": "POOL#'"$MOCK_POOL_ID"'"},
    "entityType": {"S": "COGNITO_POOL"},
    "poolId":     {"S": "'"$MOCK_POOL_ID"'"},
    "poolName":   {"S": "'"${PREFIX}-users"'"},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# Web client record
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "POOL#'"$MOCK_POOL_ID"'"},
    "sk":           {"S": "CLIENT#'"$MOCK_CLIENT_ID"'"},
    "entityType":   {"S": "COGNITO_CLIENT"},
    "clientId":     {"S": "'"$MOCK_CLIENT_ID"'"},
    "clientName":   {"S": "'"${PREFIX}-web"'"},
    "callbackUrls": {"L": [{"S": "'"$APP_URL"'/callback"}]},
    "logoutUrls":   {"L": [{"S": "'"$APP_URL"'/logout"}]},
    "createdAt":    {"S": "2026-01-01T00:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# Groups: admins/1, support/2, business/3, pro/4, free/5
for GROUP_DEF in "admins:1" "support:2" "business:3" "pro:4" "free:5"; do
  GROUP_NAME="${GROUP_DEF%%:*}"
  PRECEDENCE="${GROUP_DEF##*:}"
  $AWS dynamodb put-item \
    --table-name "$TABLE_NAME_MAIN" \
    --item '{
      "pk":         {"S": "POOL#'"$MOCK_POOL_ID"'"},
      "sk":         {"S": "GROUP#'"$GROUP_NAME"'"},
      "entityType": {"S": "COGNITO_GROUP"},
      "groupName":  {"S": "'"$GROUP_NAME"'"},
      "precedence": {"N": "'"$PRECEDENCE"'"}
    }' \
    --no-cli-pager 2>/dev/null || true
done

# Seed test user — sub is stable so dependent records stay consistent
MOCK_USER_SUB="00000000-0000-0000-0000-test-user-001"
# In local dev, we use the sub as the primary userId for simplicity
MOCK_USER_ID="$MOCK_USER_SUB"

$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "POOL#'"$MOCK_POOL_ID"'"},
    "sk":         {"S": "USER#'"$MOCK_USER_SUB"'"},
    "gsi1pk":     {"S": "EMAIL#test@costscrunch.dev"},
    "gsi1sk":     {"S": "POOL#'"$MOCK_POOL_ID"'"},
    "entityType": {"S": "COGNITO_USER"},
    "sub":        {"S": "'"$MOCK_USER_SUB"'"},
    "email":      {"S": "test@costscrunch.dev"},
    "name":       {"S": "Test User"},
    "groups":     {"L": [{"S": "pro"}]},
    "status":     {"S": "CONFIRMED"},
    "enabled":    {"BOOL": true},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

echo "  ↳ Mock pool ID:   $MOCK_POOL_ID"
echo "  ↳ Mock client ID: $MOCK_CLIENT_ID"
echo "  ↳ Test user sub:  $MOCK_USER_SUB"
echo "✅ Cognito mock ready"

# ── SES ───────────────────────────────────────────────────────────────────────
echo "📦 Verifying SES email identity: noreply@costscrunch.dev"
$AWS ses verify-email-identity \
  --email-address $FROM_EMAIL \
  --no-cli-pager 2>/dev/null || true
echo "✅ SES ready"

# ── Import Seed CSV ───────────────────────────────────────────────────────────
echo "📦 Importing seed expenses from CSV"
# Using python3 to convert CSV to DynamoDB JSON format, then AWS CLI to batch load
# This avoids the boto3 dependency in the aws-cli container image
python3 << 'PYTHONEOF'
import csv
import json

with open('/localstack/dev/seed.csv', mode='r') as f:
    reader = csv.DictReader(f)
    items = []
    for row in reader:
        # Convert flat CSV to DynamoDB JSON format (all strings/numbers)
        item = {
            "PutRequest": {
                "Item": {
                    "pk": {"S": row["pk"]},
                    "sk": {"S": row["sk"]},
                    "gsi1pk": {"S": row["gsi1pk"]},
                    "gsi1sk": {"S": row["gsi1sk"]},
                    "gsi2pk": {"S": row["gsi2pk"]},
                    "gsi2sk": {"S": row["gsi2sk"]},
                    "entityType": {"S": row["entityType"]},
                    "expenseId": {"S": row["expenseId"]},
                    "ownerId": {"S": row["ownerId"]},
                    "merchant": {"S": row["merchant"]},
                    "amount": {"N": row["amount"]},
                    "currency": {"S": row["currency"]},
                    "amountUSD": {"N": row["amountUSD"]},
                    "category": {"S": row["category"]},
                    "date": {"S": row["date"]},
                    "status": {"S": row["status"]},
                    "source": {"S": row["source"]},
                    "addedBy": {"S": row["addedBy"]},
                    "receiptKey": {"S": row["receiptKey"]} if row.get("receiptKey") else {"NULL": True}
                }
            }
        }
        items.append(item)
    
    # Write chunks of 25 (DynamoDB BatchWrite limit)
    for i in range(0, len(items), 25):
        batch = {"costscrunch-dev-main": items[i:i+25]}
        with open(f'/tmp/seed_batch_{i//25}.json', 'w') as out:
            json.dump(batch, out)
PYTHONEOF

# Upload sample PDF to S3 for seeded expenses
echo "📦 Uploading sample receipt PDF to S3"
$AWS s3 cp /localstack/dev/sample.pdf s3://$BUCKET_PROCESSED_NAME/receipts/00000000-0000-0000-0000-test-user-001/exp-001/seed/sample.pdf --no-cli-pager

# Batch load using AWS CLI (available in container)
for batch_file in /tmp/seed_batch_*.json; do
  $AWS dynamodb batch-write-item --request-items "file://$batch_file" --no-cli-pager 2>/dev/null
  rm "$batch_file"
done

echo "✅ CSV seed complete"

# ── EventBridge ───────────────────────────────────────────────────────────────
echo "📦 Creating EventBridge bus: $EVENT_BUS_NAME"
$AWS events create-event-bus \
  --name "$EVENT_BUS_NAME" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bus already exists, skipping"

# Match EventBridge rules in CDK
# Rules reference Lambda ARNs that won't exist locally — created as stubs with no targets, to be updated with real ARNs in Lambda setup 
# LocalStack doesn't validate targets on rule creation, so we can create rules before lambdas.
echo "  ↳ Creating EventBridge rules (stub targets)"
$AWS events put-rule \
  --name "${PREFIX}-scan-completed-notif" \
  --event-bus-name "$EVENT_BUS_NAME" \
  --event-pattern '{"source":["costscrunch.receipts"],"detail-type":["ReceiptScanCompleted"]}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

$AWS events put-rule \
  --name "${PREFIX}-scan-completed-ws" \
  --event-bus-name "$EVENT_BUS_NAME" \
  --event-pattern '{"source":["costscrunch.receipts"],"detail-type":["ReceiptScanCompleted"]}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

$AWS events put-rule \
  --name "${PREFIX}-expense-approved" \
  --event-bus-name "$EVENT_BUS_NAME" \
  --event-pattern '{"source":["costscrunch.expenses"],"detail-type":["ExpenseStatusChanged"],"detail":{"status":["approved","rejected"]}}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

# EventBridge Archive (matches CDK events.Archive with 30-day retention)
$AWS events create-archive \
  --archive-name "${PREFIX}-archive" \
  --event-source-arn "arn:aws:events:us-east-1:000000000000:event-bus/${EVENT_BUS_NAME}" \
  --retention-days 30 \
  --no-cli-pager 2>/dev/null || true

echo "✅ EventBridge ready (bus + rules + archive)"

# ── SQS Queues ────────────────────────────────────────────────────────────────
echo "📦 Creating SQS queues"

# scan-dlq - standard queue used as DLQ for receipt scanning
$AWS sqs create-queue \
  --queue-name "${PREFIX}-scan-dlq" \
  --attributes MessageRetentionPeriod=1209600 \
  --no-cli-pager 2>/dev/null || true

SCAN_DLQ_ARN="arn:aws:sqs:us-east-1:000000000000:${PREFIX}-scan-dlq"

# scan-queue — main processing queue (SNS -> SQS -> Lambda)
$AWS sqs create-queue \
  --queue-name "${PREFIX}-scan-queue" \
  --attributes '{
    "VisibilityTimeout": "120",
    "MessageRetentionPeriod": "1209600",
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"'"${SCAN_DLQ_ARN}"'\",\"maxReceiveCount\":\"3\"}"
  }' \
  --no-cli-pager 2>/dev/null || true

# notif-dlq — standard queue used as DLQ for notifications.fifo
$AWS sqs create-queue \
  --queue-name "${PREFIX}-notif-dlq" \
  --attributes MessageRetentionPeriod=1209600 \
  --no-cli-pager 2>/dev/null || true

# LocalStack SQS ARNs are deterministic — no need to fetch
NOTIF_DLQ_ARN="arn:aws:sqs:us-east-1:000000000000:${PREFIX}-notif-dlq"

$AWS sqs create-queue \
  --queue-name "${PREFIX}-notifications.fifo" \
  --attributes '{
    "FifoQueue": "true",
    "ContentBasedDeduplication": "true",
    "VisibilityTimeout": "60",
    "MessageRetentionPeriod": "1209600",
    "RedrivePolicy": "{\"deadLetterTargetArn\":\"'"${NOTIF_DLQ_ARN}"'\",\"maxReceiveCount\":\"3\"}"
  }' \
  --no-cli-pager 2>/dev/null || true

$AWS sqs create-queue \
  --queue-name "${PREFIX}-ws-notifier-dlq" \
  --attributes MessageRetentionPeriod=1209600 \
  --no-cli-pager 2>/dev/null || true

echo "✅ SQS ready"

# ── SNS ───────────────────────────────────────────────────────────────
echo "📦 Creating SNS topics"

# Textract async completion topic — sns-webhook Lambda subscribes here
TEXTRACT_TOPIC_ARN=$($AWS sns create-topic \
  --name "${PREFIX}-textract-completion" \
  --no-cli-pager \
  --query "TopicArn" \
  --output text 2>/dev/null || echo "arn:aws:sns:us-east-1:000000000000:${PREFIX}-textract-completion")

# Alarms topic — receives CloudWatch Alarm notifications
ALARMS_TOPIC_ARN=$($AWS sns create-topic \
  --name "${PREFIX}-alarms" \
  --no-cli-pager \
  --query "TopicArn" \
  --output text 2>/dev/null || echo "arn:aws:sns:us-east-1:000000000000:${PREFIX}-alarms")

echo "  ↳ Textract topic ARN: $TEXTRACT_TOPIC_ARN"
echo "  ↳ Alarms topic ARN:   $ALARMS_TOPIC_ARN"
echo "✅ SNS ready"

# ── SSM Parameters ────────────────────────────────────────────────────────────
echo "📦 Writing SSM parameters"

$AWS ssm put-parameter --name "/costscrunch/dev/table-name"      --value "$TABLE_NAME_MAIN"            --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/uploads-bucket"  --value "$BUCKET_UPLOADS_NAME"   --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/processed-bucket" --value "$BUCKET_PROCESSED_NAME" --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/receipts-bucket" --value "$BUCKET_RECEIPTS_NAME"  --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/event-bus-name"  --value "$EVENT_BUS_NAME"        --type String --overwrite --no-cli-pager 2>/dev/null || true
# Cognito mock IDs in place of real pool/client IDs
$AWS ssm put-parameter --name "/costscrunch/dev/user-pool-id"    --value "$MOCK_POOL_ID"     --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/user-pool-client-id" --value "$MOCK_CLIENT_ID" --type String --overwrite --no-cli-pager 2>/dev/null || true
# Stubs for paid-tier services
$AWS ssm put-parameter --name "/costscrunch/dev/pinpoint-app-id" --value "local-pinpoint-stub-000000" --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/redis-host"      --value "localhost"         --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/redis-port"           --value "6379"                       --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/textract-topic-arn"   --value "$TEXTRACT_TOPIC_ARN"        --type String --overwrite --no-cli-pager 2>/dev/null || true
$AWS ssm put-parameter --name "/costscrunch/dev/conn-table-name"      --value "$TABLE_NAME_DYNAMO_CONNECTIONS"                --type String --overwrite --no-cli-pager 2>/dev/null || true
# WebSocket endpoint is a LocalStack stub — real URL comes from CDK output in real envs
$AWS ssm put-parameter --name "/costscrunch/dev/ws-endpoint"          --value "http://localhost:4566/_aws/apigatewayv2/ws" --type String --overwrite --no-cli-pager 2>/dev/null || true
# Bedrock model ID (matches CDK BEDROCK_MODEL_ID)
$AWS ssm put-parameter --name "/costscrunch/dev/bedrock-model-id"     --value "foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0" --type String --overwrite --no-cli-pager 2>/dev/null || true

echo "✅ SSM ready"

# ── Seed test data ────────────────────────────────────────────────────────────
echo "📦 Seeding test user profile"
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":        {"S": "USER#'"$MOCK_USER_ID"'"},
    "sk":        {"S": "PROFILE#'"$MOCK_USER_ID"'"},
    "gsi1pk":    {"S": "EMAIL#test@costscrunch.dev"},
    "gsi1sk":    {"S": "USER#'"$MOCK_USER_ID"'"},
    "entityType":{"S": "USER"},
    "userId":    {"S": "'"$MOCK_USER_ID"'"},
    "cognitoSub":{"S": "'"$MOCK_USER_SUB"'"},
    "email":     {"S": "test@costscrunch.dev"},
    "name":      {"S": "Test User"},
    "currency":  {"S": "USD"},
    "timezone":  {"S": "America/New_York"},
    "locale":    {"S": "en-US"},
    "plan":      {"S": "pro"},
    "notificationPreferences": {"M": {
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

echo "📦 Seeding test group (Household)"
MOCK_GROUP_ID="group-001"
MOCK_MEMBER2_ID="00000000-0000-0000-0000-test-user-002"
MOCK_MEMBER3_ID="00000000-0000-0000-0000-test-user-003"
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "GROUP#'"$MOCK_GROUP_ID"'"},
    "sk":         {"S": "PROFILE#'"$MOCK_GROUP_ID"'"},
    "gsi1pk":     {"S": "OWNER#'"$MOCK_USER_ID"'"},
    "gsi1sk":     {"S": "GROUP#'"$MOCK_GROUP_ID"'"},
    "entityType": {"S": "GROUP"},
    "groupId":    {"S": "'"$MOCK_GROUP_ID"'"},
    "name":       {"S": "Household Expenses"},
    "type":       {"S": "household"},
    "ownerId":    {"S": "'"$MOCK_USER_ID"'"},
    "color":      {"S": "#6366f1"},
    "members":    {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"name":{"S":"Test User"},"email":{"S":"test@costscrunch.dev"},"role":{"S":"owner"},"joinedAt":{"S":"2026-01-01T00:00:00.000Z"},"totalSpend":{"N":"227.20"},"balance":{"N":"0"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER2_ID"'"},"name":{"S":"Jane Doe"},"email":{"S":"jane@costscrunch.dev"},"role":{"S":"member"},"joinedAt":{"S":"2026-01-15T00:00:00.000Z"},"totalSpend":{"N":"0"},"balance":{"N":"0"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER3_ID"'"},"name":{"S":"Bob Smith"},"email":{"S":"bob@costscrunch.dev"},"role":{"S":"member"},"joinedAt":{"S":"2026-02-01T00:00:00.000Z"},"totalSpend":{"N":"0"},"balance":{"N":"0"}}}
    ]},
    "memberCount":{"N": "3"},
    "budgets":    {"L": []},
    "currency":   {"S": "USD"},
    "approvalRequired": {"BOOL": false},
    "requireReceipts":  {"BOOL": false},
    "totalSpend": {"N": "227.20"},
    "monthSpend": {"N": "227.20"},
    "expenseCount":{"N": "2"},
    "active":     {"BOOL": true},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"},
    "updatedAt":  {"S": "2026-03-10T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# Add test user to group membership
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "USER#'"$MOCK_USER_ID"'"},
    "sk":         {"S": "GROUP_MEMBER#'"$MOCK_GROUP_ID"'"},
    "entityType": {"S": "GROUP_MEMBER"},
    "userId":     {"S": "'"$MOCK_USER_ID"'"},
    "groupId":    {"S": "'"$MOCK_GROUP_ID"'"},
    "role":       {"S": "owner"},
    "joinedAt":   {"S": "2026-01-01T00:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

echo "📦 Seeding group expenses (with splits for balance calculation)"
# exp-group-001: Whole Foods — paid by test user, split 3 ways
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "GROUP#'"$MOCK_GROUP_ID"'"},
    "sk":           {"S": "EXPENSE#exp-group-001"},
    "gsi1pk":       {"S": "STATUS#approved"},
    "gsi1sk":       {"S": "DATE#2026-03-10#exp-group-001"},
    "entityType":   {"S": "EXPENSE"},
    "expenseId":    {"S": "exp-group-001"},
    "ownerId":      {"S": "'"$MOCK_USER_ID"'"},
    "groupId":      {"S": "'"$MOCK_GROUP_ID"'"},
    "merchant":     {"S": "Whole Foods"},
    "amount":       {"N": "85.20"},
    "currency":     {"S": "USD"},
    "amountUSD":    {"N": "85.20"},
    "category":     {"S": "Groceries"},
    "date":         {"S": "2026-03-10"},
    "status":       {"S": "approved"},
    "source":       {"S": "manual"},
    "splitMethod":  {"S": "equal"},
    "splits":       {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"amount":{"N":"28.40"},"percentage":{"N":"33.33"},"shares":{"N":"1"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER2_ID"'"},"amount":{"N":"28.40"},"percentage":{"N":"33.33"},"shares":{"N":"1"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER3_ID"'"},"amount":{"N":"28.40"},"percentage":{"N":"33.34"},"shares":{"N":"1"}}}
    ]},
    "createdAt":    {"S": "2026-03-10T10:00:00.000Z"},
    "updatedAt":    {"S": "2026-03-10T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# exp-group-002: Electric Bill — paid by test user, split 3 ways
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "GROUP#'"$MOCK_GROUP_ID"'"},
    "sk":           {"S": "EXPENSE#exp-group-002"},
    "gsi1pk":       {"S": "STATUS#approved"},
    "gsi1sk":       {"S": "DATE#2026-03-10#exp-group-002"},
    "entityType":   {"S": "EXPENSE"},
    "expenseId":    {"S": "exp-group-002"},
    "ownerId":      {"S": "'"$MOCK_USER_ID"'"},
    "groupId":      {"S": "'"$MOCK_GROUP_ID"'"},
    "merchant":     {"S": "Electric Bill"},
    "amount":       {"N": "142.00"},
    "currency":     {"S": "USD"},
    "amountUSD":    {"N": "142.00"},
    "category":     {"S": "Utilities"},
    "date":         {"S": "2026-03-10"},
    "status":       {"S": "approved"},
    "source":       {"S": "manual"},
    "splitMethod":  {"S": "equal"},
    "splits":       {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"amount":{"N":"47.33"},"percentage":{"N":"33.33"},"shares":{"N":"1"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER2_ID"'"},"amount":{"N":"47.33"},"percentage":{"N":"33.33"},"shares":{"N":"1"}}},
      {"M": {"userId":{"S":"'"$MOCK_MEMBER3_ID"'"},"amount":{"N":"47.34"},"percentage":{"N":"33.34"},"shares":{"N":"1"}}}
    ]},
    "createdAt":    {"S": "2026-03-10T10:00:00.000Z"},
    "updatedAt":    {"S": "2026-03-10T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# ── Seed mock groups (matches frontend/src/mocks/groups.ts) ─────────────────
echo "📦 Seeding mock groups (g1, g2, g3)"

# g1 — Q1 Offsite (business/project type, 2 members seeded)
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "GROUP#g1"},
    "sk":         {"S": "PROFILE#g1"},
    "gsi1pk":     {"S": "OWNER#'"$MOCK_USER_ID"'"},
    "gsi1sk":     {"S": "GROUP#g1"},
    "entityType": {"S": "GROUP"},
    "groupId":    {"S": "g1"},
    "name":       {"S": "Q1 Offsite"},
    "type":       {"S": "project"},
    "ownerId":    {"S": "'"$MOCK_USER_ID"'"},
    "color":      {"S": "#6366f1"},
    "members":    {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"name":{"S":"Test User"},"email":{"S":"test@costscrunch.dev"},"role":{"S":"owner"},"joinedAt":{"S":"2026-01-01T00:00:00.000Z"},"totalSpend":{"N":"535.93"},"balance":{"N":"0"}}},
      {"M": {"userId":{"S":"user2"},"name":{"S":"Alex Kim"},"email":{"S":"alex@costscrunch.dev"},"role":{"S":"member"},"joinedAt":{"S":"2026-01-05T00:00:00.000Z"},"totalSpend":{"N":"0"},"balance":{"N":"0"}}}
    ]},
    "memberCount":{"N": "2"},
    "budgets":    {"L": []},
    "currency":   {"S": "USD"},
    "approvalRequired": {"BOOL": false},
    "requireReceipts":  {"BOOL": false},
    "totalSpend": {"N": "4287.50"},
    "monthSpend": {"N": "535.93"},
    "expenseCount":{"N": "3"},
    "active":     {"BOOL": true},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"},
    "updatedAt":  {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# g2 — Acme Corp (business type, 2 members seeded)
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "GROUP#g2"},
    "sk":         {"S": "PROFILE#g2"},
    "gsi1pk":     {"S": "OWNER#'"$MOCK_USER_ID"'"},
    "gsi1sk":     {"S": "GROUP#g2"},
    "entityType": {"S": "GROUP"},
    "groupId":    {"S": "g2"},
    "name":       {"S": "Acme Corp"},
    "type":       {"S": "business"},
    "ownerId":    {"S": "'"$MOCK_USER_ID"'"},
    "color":      {"S": "#f59e0b"},
    "members":    {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"name":{"S":"Test User"},"email":{"S":"test@costscrunch.dev"},"role":{"S":"owner"},"joinedAt":{"S":"2026-01-01T00:00:00.000Z"},"totalSpend":{"N":"4134.39"},"balance":{"N":"0"}}},
      {"M": {"userId":{"S":"user3"},"name":{"S":"Sarah K."},"email":{"S":"sarah@costscrunch.dev"},"role":{"S":"member"},"joinedAt":{"S":"2026-01-10T00:00:00.000Z"},"totalSpend":{"N":"1204.33"},"balance":{"N":"0"}}}
    ]},
    "memberCount":{"N": "2"},
    "budgets":    {"L": []},
    "currency":   {"S": "USD"},
    "approvalRequired": {"BOOL": true},
    "approvalThreshold":{"N": "500"},
    "requireReceipts":  {"BOOL": true},
    "requireReceiptsAbove":{"N": "100"},
    "costCenters":{"L": [{"S":"ENGINEERING"},{"S":"MARKETING"}]},
    "projectCodes":{"L": [{"S":"ACME-CLOUD"},{"S":"ACME-OPS"}]},
    "totalSpend": {"N": "12403.18"},
    "monthSpend": {"N": "4134.39"},
    "expenseCount":{"N": "8"},
    "active":     {"BOOL": true},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"},
    "updatedAt":  {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# g3 — Home (household type, 2 members seeded)
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":         {"S": "GROUP#g3"},
    "sk":         {"S": "PROFILE#g3"},
    "gsi1pk":     {"S": "OWNER#'"$MOCK_USER_ID"'"},
    "gsi1sk":     {"S": "GROUP#g3"},
    "entityType": {"S": "GROUP"},
    "groupId":    {"S": "g3"},
    "name":       {"S": "Home"},
    "type":       {"S": "household"},
    "ownerId":    {"S": "'"$MOCK_USER_ID"'"},
    "color":      {"S": "#10b981"},
    "members":    {"L": [
      {"M": {"userId":{"S":"'"$MOCK_USER_ID"'"},"name":{"S":"Test User"},"email":{"S":"test@costscrunch.dev"},"role":{"S":"owner"},"joinedAt":{"S":"2026-01-01T00:00:00.000Z"},"totalSpend":{"N":"1620.50"},"balance":{"N":"0"}}},
      {"M": {"userId":{"S":"user4"},"name":{"S":"Pat"},"email":{"S":"pat@costscrunch.dev"},"role":{"S":"member"},"joinedAt":{"S":"2026-01-01T00:00:00.000Z"},"totalSpend":{"N":"1620.50"},"balance":{"N":"0"}}}
    ]},
    "memberCount":{"N": "2"},
    "budgets":    {"L": []},
    "currency":   {"S": "USD"},
    "approvalRequired": {"BOOL": false},
    "requireReceipts":  {"BOOL": false},
    "totalSpend": {"N": "3241.00"},
    "monthSpend": {"N": "800.00"},
    "expenseCount":{"N": "5"},
    "active":     {"BOOL": true},
    "createdAt":  {"S": "2026-01-01T00:00:00.000Z"},
    "updatedAt":  {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# Add test user as group member for g1, g2, g3
for G_ID in g1 g2 g3; do
  $AWS dynamodb put-item \
    --table-name "$TABLE_NAME_MAIN" \
    --item '{
      "pk":         {"S": "USER#'"$MOCK_USER_ID"'"},
      "sk":         {"S": "GROUP_MEMBER#'"$G_ID"'"},
      "entityType": {"S": "GROUP_MEMBER"},
      "userId":     {"S": "'"$MOCK_USER_ID"'"},
      "groupId":    {"S": "'"$G_ID"'"},
      "role":       {"S": "owner"},
      "joinedAt":   {"S": "2026-01-01T00:00:00.000Z"}
    }' \
    --no-cli-pager 2>/dev/null || true
done

# ── Seed mock expenses (matches frontend/src/mocks/expenses.ts) ──────────────
echo "📦 Seeding mock expenses (e1, e2, e3)"

# e1 — Personal expense, no group
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "USER#'"$MOCK_USER_ID"'"},
    "sk":           {"S": "EXPENSE#e1"},
    "gsi1pk":       {"S": "STATUS#approved"},
    "gsi1sk":       {"S": "DATE#2026-03-01#e1"},
    "entityType":   {"S": "EXPENSE"},
    "expenseId":    {"S": "e1"},
    "ownerId":      {"S": "'"$MOCK_USER_ID"'"},
    "groupId":      {"NULL": true},
    "merchant":     {"S": "Whole Foods Market"},
    "description":  {"S": "Weekly groceries"},
    "amount":       {"N": "142.87"},
    "currency":     {"S": "USD"},
    "amountUSD":    {"N": "142.87"},
    "category":     {"S": "Groceries"},
    "subcategory":  {"S": "Food"},
    "tags":         {"L": [{"S": "groceries"}, {"S": "personal"}]},
    "date":         {"S": "2026-03-01"},
    "status":       {"S": "approved"},
    "approvedAt":   {"S": "2026-02-28T14:20:00Z"},
    "reimbursedAt": {"S": "2026-03-01T09:00:00Z"},
    "receipt":      {"BOOL": true},
    "receiptKey":   {"S": "receipts/e1-wholefoods.pdf"},
    "source":       {"S": "manual"},
    "addedBy":      {"S": "You"},
    "reimbursable": {"BOOL": true},
    "createdAt":    {"S": "2026-03-01T10:00:00.000Z"},
    "updatedAt":    {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# e2 — Group expense under g1 (Q1 Offsite), with equal split
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "USER#'"$MOCK_USER_ID"'"},
    "sk":           {"S": "EXPENSE#e2"},
    "gsi1pk":       {"S": "STATUS#approved"},
    "gsi1sk":       {"S": "DATE#2026-03-01#e2"},
    "entityType":   {"S": "EXPENSE"},
    "expenseId":    {"S": "e2"},
    "ownerId":      {"S": "'"$MOCK_USER_ID"'"},
    "groupId":      {"S": "g1"},
    "merchant":     {"S": "Delta Airlines"},
    "description":  {"S": "NYC → SFO"},
    "amount":       {"N": "428"},
    "currency":     {"S": "USD"},
    "amountUSD":    {"N": "428"},
    "category":     {"S": "Travel"},
    "subcategory":  {"S": "Flights"},
    "tags":         {"L": [{"S": "travel"}, {"S": "business"}]},
    "date":         {"S": "2026-03-01"},
    "status":       {"S": "approved"},
    "receipt":      {"BOOL": true},
    "splitMethod":  {"S": "equal"},
    "splits":       {"L": [
      {"M": {"userId": {"S": "'"$MOCK_USER_ID"'"}, "amount": {"N": "214"}, "percentage": {"N": "50"}, "shares": {"N": "1"}}},
      {"M": {"userId": {"S": "user2"}, "amount": {"N": "214"}, "percentage": {"N": "50"}, "shares": {"N": "1"}}}
    ]},
    "projectCode":  {"S": "Q1-OFFSITE"},
    "costCenter":   {"S": "MARKETING"},
    "source":       {"S": "manual"},
    "addedBy":      {"S": "You"},
    "reimbursable": {"BOOL": true},
    "createdAt":    {"S": "2026-03-01T10:00:00.000Z"},
    "updatedAt":    {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# e3 — Group expense under g2 (Acme Corp), added by another user
$AWS dynamodb put-item \
  --table-name "$TABLE_NAME_MAIN" \
  --item '{
    "pk":           {"S": "USER#user3"},
    "sk":           {"S": "EXPENSE#e3"},
    "gsi1pk":       {"S": "STATUS#approved"},
    "gsi1sk":       {"S": "DATE#2026-03-01#e3"},
    "entityType":   {"S": "EXPENSE"},
    "expenseId":    {"S": "e3"},
    "ownerId":      {"S": "user3"},
    "groupId":      {"S": "g2"},
    "merchant":     {"S": "AWS Console"},
    "amount":       {"N": "1204.33"},
    "currency":     {"S": "USD"},
    "amountUSD":    {"N": "1204.33"},
    "category":     {"S": "Software"},
    "subcategory":  {"S": "Cloud Services"},
    "tags":         {"L": [{"S": "software"}, {"S": "infra"}]},
    "date":         {"S": "2026-03-01"},
    "status":       {"S": "approved"},
    "approvedAt":   {"S": "2026-02-26T11:30:00Z"},
    "projectCode":  {"S": "ACME-CLOUD"},
    "costCenter":   {"S": "ENGINEERING"},
    "source":       {"S": "scan"},
    "addedBy":      {"S": "Sarah K."},
    "reimbursable": {"BOOL": true},
    "createdAt":    {"S": "2026-03-01T10:00:00.000Z"},
    "updatedAt":    {"S": "2026-03-01T10:00:00.000Z"}
  }' \
  --no-cli-pager 2>/dev/null || true

# Ensure watermark is visible for the host setup script
echo "--------------------------------------------------"
echo "✅✅✅ LocalStack seed complete! [ID: ${RUN_ID:-none}]"
echo "--------------------------------------------------"
echo "Resource summary:"
echo "  DynamoDB main table:  $TABLE_NAME_MAIN"
echo "  DynamoDB conn table:  $TABLE_NAME_DYNAMO_CONNECTIONS"
echo "  Uploads bucket:       $BUCKET_UPLOADS_NAME"
echo "  Processed bucket:     $BUCKET_PROCESSED_NAME"
echo "  Receipts bucket:      $BUCKET_RECEIPTS_NAME"
echo "  Assets bucket:        $BUCKET_ASSETS"
echo "  EventBridge bus:      $EVENT_BUS_NAME"
echo "  Textract SNS topic:   $TEXTRACT_TOPIC_ARN"
echo "  Alarms SNS topic:     $ALARMS_TOPIC_ARN"
echo "  Cognito mock:"
echo "    pool ID:            $MOCK_POOL_ID"
echo "    client ID:          $MOCK_CLIENT_ID"
echo "    test user sub:      $MOCK_USER_SUB"
echo ""
echo "Useful commands:"
echo "  List tables:  aws --endpoint-url=http://localhost:4566 dynamodb list-tables"
echo "  List buckets: aws --endpoint-url=http://localhost:4566 s3 ls"
echo "  List queues:  aws --endpoint-url=http://localhost:4566 sqs list-queues"
echo "  List buses:   aws --endpoint-url=http://localhost:4566 events list-event-buses"
echo "  Scan table:       aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name $TABLE_NAME_MAIN"
echo "  Scan conn table:  aws --endpoint-url=http://localhost:4566 dynamodb scan --table-name $TABLE_NAME_DYNAMO_CONNECTIONS"
echo "  List SNS topics:  aws --endpoint-url=http://localhost:4566 sns list-topics"