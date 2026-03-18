#!/usr/bin/env bash
# ─── CostsCrunch — LocalStack Lambda + API GW Bootstrap ────────────────────
# Runs inside LocalStack container via init/ready.d/ after services are healthy.
# Works together with setup.sh (data seeding) — this script handles compute only.
#
# Prerequisites:
#   - setup.sh has already seeded DynamoDB, S3, SSM parameters
#   - SAM build artifacts exist at /opt/sam-build/
#
# This script creates:
#   IAM execution role, 6 Lambda functions, HTTP API, 16 routes, CORS, SNS subscription

set -euo pipefail

AWS="aws --endpoint-url=http://localhost:4566 --region us-east-1"
API_NAME="costscrunch-dev-api"
ROLE_NAME="costscrunch-dev-lambda-role"
LAMBDA_BUILD="/opt/lambda-build"

echo "🔧 Lambda + API GW bootstrap starting..."

# ── IAM Role ────────────────────────────────────────────────────────────────
echo "📦 Creating IAM execution role"
# Trust policy allows LocalStack's Lambda service to assume this role
$AWS iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }' \
  --no-cli-pager 2>/dev/null || echo "  ↳ Role already exists, skipping"

# Basic execution policy — LocalStack doesn't enforce but Lambda expects it
$AWS iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "LambdaBasicExecution" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": ["logs:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["dynamodb:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["s3:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["ses:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["sns:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["sqs:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["events:*"], "Resource": "*" },
      { "Effect": "Allow", "Action": ["bedrock:InvokeModel"], "Resource": "*" }
    ]
  }' \
  --no-cli-pager 2>/dev/null || true

ROLE_ARN="arn:aws:iam::000000000000:role/${ROLE_NAME}"
echo "  ↳ Role ARN: $ROLE_ARN"

# ── Helper: deploy Lambda from SAM build artifact ───────────────────────────
deploy_function() {
  local NAME=$1
  local HANDLER=$2
  local BUILD_DIR="${LAMBDA_BUILD}/${NAME}"

  if [ ! -d "$BUILD_DIR" ]; then
    echo "  ⚠️  Build artifact not found: $BUILD_DIR (run 'sam build' first)"
    return 1
  fi

  local ZIP_PATH="/tmp/${NAME}.zip"
  (cd "$BUILD_DIR" && zip -q -r "$ZIP_PATH" .)

  $AWS lambda create-function \
    --function-name "$NAME" \
    --runtime nodejs20.x \
    --handler "$HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_PATH}" \
    --environment Variables='{
      "AWS_ENDPOINT_URL":"http://localstack:4566",
      "AWS_ACCESS_KEY_ID":"test",
      "AWS_SECRET_ACCESS_KEY":"test",
      "AWS_REGION":"us-east-1",
      "MOCK_AUTH":"true",
      "TABLE_NAME_MAIN":"costscrunch-dev-main",
      "TABLE_NAME_CONNECTIONS":"costscrunch-dev-connections",
      "FROM_EMAIL":"noreply@costscrunch.dev",
      "BUCKET_UPLOADS_NAME":"costscrunch-dev-uploads-000000000000",
      "BUCKET_PROCESSED_NAME":"costscrunch-dev-processed-000000000000",
      "BUCKET_RECEIPTS_NAME":"costscrunch-dev-receipts-000000000000",
      "TEXTRACT_SNS_TOPIC_ARN":"arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract-completion",
      "TEXTRACT_ROLE_ARN":"arn:aws:iam::000000000000:role/test-role",
      "EVENT_BUS_NAME":"costscrunch-dev-events"
    }' \
    --no-cli-pager 2>/dev/null && echo "  ✅ $NAME created" || echo "  ↳ $NAME already exists, updating..."

  $AWS lambda update-function-code \
    --function-name "$NAME" \
    --zip-file "fileb://${ZIP_PATH}" \
    --no-cli-pager 2>/dev/null || true

  rm -f "$ZIP_PATH"
}

# ── Lambda Functions ────────────────────────────────────────────────────────
echo "📦 Deploying Lambda functions"
deploy_function "GroupsFunction"      "index.handler"
deploy_function "ExpensesFunction"    "index.handler"
deploy_function "ReceiptsFunction"    "index.handler"
deploy_function "AnalyticsFunction"   "index.handler"
deploy_function "SnsWebhookFunction"  "index.handler"
deploy_function "WsNotifierFunction"  "index.handler"

# ── SNS Subscription (Textract Completion) ──────────────────────────────────
echo "📦 Subscribing SnsWebhookFunction to Textract topic"
$AWS sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract-completion" \
  --protocol lambda \
  --notification-endpoint "arn:aws:lambda:us-east-1:000000000000:function:SnsWebhookFunction" \
  --no-cli-pager 2>/dev/null || true

# ── HTTP API ─────────────────────────────────────────────────────────────────
echo "📦 Creating HTTP API"
API_ID=$($AWS apigatewayv2 create-api \
  --name "$API_NAME" \
  --protocol-type HTTP \
  --no-cli-pager \
  --query 'ApiId' \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$($AWS apigatewayv2 get-apis \
    --no-cli-pager \
    --query "Items[?Name=='${API_NAME}'].ApiId | [0]" \
    --output text)
  echo "  ↳ Existing API: $API_ID"
else
  echo "  ✅ Created API: $API_ID"
fi

# ── Helper: create route + integration ──────────────────────────────────────
add_route() {
  local METHOD=$1
  local PATH=$2
  local FUNCTION=$3

  INTEGRATION_ID=$($AWS apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION}" \
    --payload-format-version 2.0 \
    --no-cli-pager \
    --query 'IntegrationId' \
    --output text)

  $AWS apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "${METHOD} ${PATH}" \
    --target "integrations/${INTEGRATION_ID}" \
    --no-cli-pager 2>/dev/null || true

  # Grant API GW permission to invoke the Lambda
  $AWS lambda add-permission \
    --function-name "$FUNCTION" \
    --statement-id "api-${METHOD}-${PATH//\//-}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:us-east-1:000000000000:${API_ID}/*/*${PATH}" \
    --no-cli-pager 2>/dev/null || true
}

# ── Routes ──────────────────────────────────────────────────────────────────
echo "📦 Creating routes"

# Groups
add_route GET    /groups                        GroupsFunction
add_route POST   /groups                        GroupsFunction
add_route GET    /groups/{id}                   GroupsFunction
add_route PATCH  /groups/{id}                   GroupsFunction
add_route GET    /groups/{id}/balances          GroupsFunction
add_route POST   /groups/{id}/members           GroupsFunction
add_route DELETE /groups/{id}/members/{userId}  GroupsFunction

# Expenses
add_route GET    /expenses           ExpensesFunction
add_route POST   /expenses           ExpensesFunction
add_route GET    /expenses/{id}      ExpensesFunction
add_route PATCH  /expenses/{id}      ExpensesFunction
add_route DELETE /expenses/{id}      ExpensesFunction

# Receipts
add_route POST   /receipts/upload-url         ReceiptsFunction
add_route GET    /receipts/{expenseId}/scan    ReceiptsFunction

# Analytics
add_route GET    /analytics/summary   AnalyticsFunction
add_route GET    /analytics/trends    AnalyticsFunction
add_route GET    /analytics/chartData AnalyticsFunction

# ── CORS ────────────────────────────────────────────────────────────────────
echo "📦 Configuring CORS"
APP_URL="${APP_URL:-http://localhost:3000}"

# Create $default route for OPTIONS preflight
DEFAULT_INTEGRATION=$($AWS apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type MOCK \
  --no-cli-pager \
  --query 'IntegrationId' \
  --output text)

$AWS apigatewayv2 create-route \
  --api-id "$API_ID" \
  --route-key '$default' \
  --target "integrations/${DEFAULT_INTEGRATION}" \
  --no-cli-pager 2>/dev/null || true

$AWS apigatewayv2 update-api \
  --api-id "$API_ID" \
  --cors-configuration '{
    "AllowOrigins": ["'"$APP_URL"'", "*"],
    "AllowMethods": ["GET","POST","PATCH","DELETE","OPTIONS"],
    "AllowHeaders": ["*"],
    "MaxAge": 3600,
    "AllowCredentials": false
  }' \
  --no-cli-pager 2>/dev/null || true

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "📦 Deploying API"
$AWS apigatewayv2 create-deployment \
  --api-id "$API_ID" \
  --no-cli-pager 2>/dev/null || true

STAGE_ID=$($AWS apigatewayv2 get-stages \
  --api-id "$API_ID" \
  --no-cli-pager \
  --query "Items[?StageName=='local'].StageId | [0]" \
  --output text 2>/dev/null || echo "")

if [ -z "$STAGE_ID" ] || [ "$STAGE_ID" = "None" ] || [ "$STAGE_ID" = "" ]; then
  $AWS apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name local \
    --no-cli-pager 2>/dev/null || true
fi

API_URL="http://localhost:4566/restapis/${API_ID}/local/_user_request_"
echo ""
echo "✅✅✅ Lambda + API GW bootstrap complete!"
echo "  API endpoint: $API_URL"
echo ""
echo "To use this URL from your frontend, set:"
echo "  VITE_API_URL=$API_URL"
