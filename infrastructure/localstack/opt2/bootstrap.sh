#!/usr/bin/env bash
# ─── CostsCrunch — LocalStack Lambda + API GW Bootstrap (v1 REST API) ──────
# Runs inside LocalStack container via init/ready.d/ after services are healthy.
# Works together with setup.sh (data seeding) — this script handles compute only.

set -euo pipefail

# Use absolute path to avoid "command not found" in some container environments
AWS="/usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1"
API_NAME="costscrunch-dev-api"
ROLE_NAME="costscrunch-dev-lambda-role"
LAMBDA_BUILD="/opt/lambda-build"

echo "🔧 Lambda + API GW bootstrap starting..."

# ── Sync: Wait for data seed to be visible inside LocalStack ────────────────
echo "⏳ Waiting for data layer to be ready (seed verification)..."
MAX_SYNC_RETRIES=30
for i in $(seq 1 $MAX_SYNC_RETRIES); do
  if $AWS dynamodb describe-table --table-name "costscrunch-dev-main" >/dev/null 2>&1; then
    echo "   ✅ Data layer verified."
    break
  fi
  sleep 2
done

# ── IAM Role ────────────────────────────────────────────────────────────────
echo "📦 Creating IAM execution role"
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
  2>/dev/null || echo "  ↳ Role already exists, skipping"

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
  2>/dev/null || true

ROLE_ARN="arn:aws:iam::000000000000:role/${ROLE_NAME}"

# ── Helper: deploy Lambda from build artifact ──────────────────────────────
deploy_function() {
  local NAME=$1
  local HANDLER=$2
  local BUILD_DIR="${LAMBDA_BUILD}/${NAME}"

  if [ ! -d "$BUILD_DIR" ]; then
    echo "  ⚠️  Build artifact not found: $BUILD_DIR"
    return 1
  fi

  local ZIP_PATH="/tmp/${NAME}.zip"
  echo "  ↳ Zipping $BUILD_DIR to $ZIP_PATH"
  (cd "$BUILD_DIR" && zip -q -r "$ZIP_PATH" .)

  # HARDCODED Environment for local development to avoid shell interpolation issues
  # Using a single cat with quoted HEREDOC to ensure literal output
  cat > "/tmp/${NAME}-env.json" << 'JSONEOF'
{
  "Variables": {
    "AWS_ENDPOINT_URL": "http://localstack:4566",
    "AWS_ACCESS_KEY_ID": "test",
    "AWS_SECRET_ACCESS_KEY": "test",
    "AWS_REGION": "us-east-1",
    "MOCK_AUTH": "true",
    "ENVIRONMENT": "dev",
    "TABLE_NAME_MAIN": "costscrunch-dev-main",
    "TABLE_NAME_CONNECTIONS": "costscrunch-dev-connections",
    "FROM_EMAIL": "noreply@costscrunch.dev",
    "BUCKET_UPLOADS_NAME": "costscrunch-dev-uploads-000000000000",
    "BUCKET_PROCESSED_NAME": "costscrunch-dev-processed-000000000000",
    "BUCKET_RECEIPTS_NAME": "costscrunch-dev-receipts-000000000000",
    "TEXTRACT_SNS_TOPIC_ARN": "arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract-completion",
    "TEXTRACT_ROLE_ARN": "arn:aws:iam::000000000000:role/test-role",
    "EVENT_BUS_NAME": "costscrunch-dev-events"
  }
}
JSONEOF

  echo "  ↳ Creating/Updating Lambda function $NAME"
  if ! $AWS lambda create-function \
    --function-name "$NAME" \
    --runtime nodejs20.x \
    --handler "$HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_PATH}" \
    --environment "file:///tmp/${NAME}-env.json" 2>/dev/null; then
    
    $AWS lambda update-function-code --function-name "$NAME" --zip-file "fileb://${ZIP_PATH}" >/dev/null
    $AWS lambda update-function-configuration --function-name "$NAME" --environment "file:///tmp/${NAME}-env.json" >/dev/null
  fi
}

# ── Lambda Functions ────────────────────────────────────────────────────────
echo "📦 Deploying Lambda functions"
deploy_function "GroupsFunction"      "index.handler"
deploy_function "ExpensesFunction"    "index.handler"
deploy_function "ReceiptsFunction"    "index.handler"
deploy_function "AnalyticsFunction"   "index.handler"
deploy_function "SnsWebhookFunction"  "index.handler"
deploy_function "WsNotifierFunction"  "index.handler"
deploy_function "HealthFunction"      "index.handler"

# ── REST API (v1) ──────────────────────────────────────────────────────────
echo "📦 Creating REST API"
API_ID=$($AWS apigateway create-rest-api --name "$API_NAME" --query 'id' --output text 2>/dev/null || echo "")
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$($AWS apigateway get-rest-apis --query "items[?name=='${API_NAME}'].id | [0]" --output text)
fi

ROOT_RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/'].id | [0]" --output text)

add_route() {
  local ROUTE_PATH=$1
  local FUNCTION=$2
  local PATH_PART=${ROUTE_PATH#/}
  
  local RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/$PATH_PART'].id | [-1]" --output text 2>/dev/null | tr -d '\r')
  if [ -z "$RES_ID" ] || [ "$RES_ID" = "None" ]; then
    RES_ID=$($AWS apigateway create-resource --rest-api-id "$API_ID" --parent-id "$ROOT_RES_ID" --path-part "$PATH_PART" --query 'id' --output text | tr -d '\r')
  fi

  for METHOD in GET POST PUT PATCH DELETE; do
    $AWS apigateway put-method --rest-api-id "$API_ID" --resource-id "$RES_ID" --http-method "$METHOD" --authorization-type "NONE" 2>/dev/null || true
    $AWS apigateway put-integration --rest-api-id "$API_ID" --resource-id "$RES_ID" --http-method "$METHOD" --type AWS_PROXY --integration-http-method POST \
      --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION}/invocations" 2>/dev/null || true
    $AWS lambda add-permission --function-name "$FUNCTION" --statement-id "api-$(date +%s)" --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
      --source-arn "arn:aws:execute-api:us-east-1:000000000000:${API_ID}/*" 2>/dev/null || true
  done
}

add_route /groups GroupsFunction
add_route /expenses ExpensesFunction
add_route /receipts ReceiptsFunction
add_route /analytics AnalyticsFunction
add_route /health HealthFunction

# ── CORS ────────────────────────────────────────────────────────────────────
echo "📦 Configuring CORS via Enforcer"
bash "$(dirname "$0")/enable-cors.sh" "$API_ID"

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "📦 Deploying API"
$AWS apigateway create-deployment --rest-api-id "$API_ID" --stage-name local >/dev/null 2>&1 || true

echo "✅✅✅ Bootstrap complete!"
echo "  VITE_API_URL=http://localhost:4566/restapis/${API_ID}/local/_user_request_"
