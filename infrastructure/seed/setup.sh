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

# ── S3 — Assets Bucket ───────────────────────────────────────────────────────
echo "📦 Creating S3 assets bucket: $BUCKET_ASSETS"
$AWS s3api create-bucket \
  --bucket "$BUCKET_ASSETS" \
    --no-cli-pager 2>/dev/null || echo "  ↳ Bucket already exists, skipping"

# Block all public access (matches CDK publicReadAccess: false + blockPublicAccess: BlockPublicAccess.BLOCK_ALL)
$AWS s3api put-public-access-block \
    --bucket "$BUCKET_ASSETS" \
    --public-access-block-configuration '{
      "BlockPublicAcls": true,
      "IgnorePublicAcls": true,
      "BlockPublicPolicy": true,
      "RestrictPublicBuckets": true
    }' \
    --no-cli-pager 2>/dev/null || true

echo "✅ Assets bucket ready"

# ── Cognito User Pool ─────────────────────────────────────────────────────────
echo "📦 Creating Cognito User Pool: ${PREFIX}-users"
USER_POOL_ID=$($AWS cognito-idp create-user-pool \
  --pool-name "${PREFIX}-users" \
  --policies '{
    "PasswordPolicy": {
      "MinimumLength": 8,
      "RequireUppercase": true,
      "RequireLowercase": true,
      "RequireNumbers": true,
      "RequireSymbols": true,
      "TemporaryPasswordValidityDays": 1
    }
  }' \
  --auto-verified-attributes email \
  --username-attributes email \
  --account-recovery-setting '{
    "RecoveryMechanisms": [{"Priority": 1, "Name": "verified_email"}]
  }' \
  --no-cli-pager 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['UserPool']['Id'])" 2>/dev/null \
  || $AWS cognito-idp list-user-pools --max-results 10 --no-cli-pager 2>/dev/null \
     | python3 -c "import sys,json; pools=[p for p in json.load(sys.stdin)['UserPools'] if '${PREFIX}-users' in p['Name']]; print(pools[0]['Id'] if pools else 'unknown')" 2>/dev/null)

echo "  ↳ User Pool ID: $USER_POOL_ID"

# Web client (CDK Webclient - SRP flow, OAuth authorization code flow)
echo "📦 Creating Cognito User Pool Client: ${PREFIX}-web-client"
$AWS cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-name "${PREFIX}-web" \
  --no-generate-secret \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --access-token-validity 15 \
  --refresh-token-validity 30 \
  --token-validity-units '{"AccessToken":"minutes","RefreshToken":"days"}' \
  --callback-urls '["http://localhost:3000/callback"]' \
  --logout-urls '["http://localhost:3000/logout"]' \
  --supported-identity-providers COGNITO \
  --no-cli-pager 2>/dev/null || echo "  ↳ User pool client already exists, skipping"

# Cognito groups (matches CDK: admins/1, support/2, business/3, pro/4, free/5)
for GROUP_DEF in "admins:1" "support:2" "business:3" "pro:4" "free:5"; do
  GROUP_NAME="${GROUP_DEF%%:*}"
  PRECEDENCE="${GROUP_DEF##*:}"
  $AWS cognito-idp create-group \
    --user-pool-id "$USER_POOL_ID" \
    --group-name "$GROUP_NAME" \
    --precedence "$PRECEDENCE" \
    --no-cli-pager 2>/dev/null || echo "  ↳ Group $GROUP_NAME already exists, skipping"
done

echo "✅ Cognito ready"

# ── SES ───────────────────────────────────────────────────────────────────────
echo "📦 Verifying SES email identity: noreply@costscrunch.com"
$AWS ses verify-email-identity \
  --email-address "noreply@costscrunch.com" \
  --no-cli-pager 2>/dev/null || true
echo "✅ SES ready"

# ── EventBridge ───────────────────────────────────────────────────────────────
echo "📦 Creating EventBridge bus: $EVENT_BUS"
$AWS events create-event-bus \
  --name "$EVENT_BUS" \
  --no-cli-pager 2>/dev/null || echo "  ↳ Bus already exists, skipping"

# Match EventBridge rules in CDK
# Rules reference Lambda ARNs that won't exist locally — created as stubs with no targets, to be updated with real ARNs in Lambda setup 
# LocalStack doesn't validate targets on rule creation, so we can create rules before lambdas.
echo "  ↳ Creating EventBridge rules (stub targets)"
$AWS events put-rule \
  --name "${PREFIX}-scan-completed" \
  --event-bus-name "$EVENT_BUS" \
  --event-pattern '{"source":["costscrunch.receipts"],"detail-type":["ReceiptScanCompleted"]}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

$AWS events put-rule \
  --name "${PREFIX}-expense-approved" \
  --event-bus-name "$EVENT_BUS" \
  --event-pattern '{"source":["costscrunch.expenses"],"detail-type":["ExpenseStatusChanged"],"detail":{"status":["approved","rejected"]}}' \
  --state ENABLED \
  --no-cli-pager 2>/dev/null || true

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