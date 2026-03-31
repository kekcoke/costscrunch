#!/usr/bin/env bash
# ─── CostsCrunch — LocalStack Lambda + API GW Bootstrap (v1 REST API) ──────
# Runs inside LocalStack container via init/ready.d/ after services are healthy.
# Works together with setup.sh (data seeding) — this script handles compute only.

set -euo pipefail

# Use absolute path to avoid "command not found" in some container environments
AWS_CMD=(/usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1)
API_NAME="costscrunch-dev-api"
ROLE_NAME="costscrunch-dev-lambda-role"
LAMBDA_BUILD="/opt/lambda-build"

echo "🔧 Lambda + API GW bootstrap starting..."


# ── Sync: Wait for data seed to be visible inside LocalStack ────────────────
echo "⏳ Waiting for data layer to be ready (seed verification)..."
MAX_SYNC_RETRIES=30
for i in $(seq 1 $MAX_SYNC_RETRIES); do
  if "${AWS_CMD[@]}" dynamodb describe-table --table-name "costscrunch-dev-main" >/dev/null 2>&1; then
    echo "   ✅ Data layer verified."
    break
  fi
  sleep 2
done

# ── IAM Role ────────────────────────────────────────────────────────────────
echo "📦 Creating IAM execution role"
"${AWS_CMD[@]}" iam create-role \
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

"${AWS_CMD[@]}" iam put-role-policy \
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
  if ! "${AWS_CMD[@]}" lambda create-function \
    --function-name "$NAME" \
    --runtime nodejs20.x \
    --handler "$HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_PATH}" \
    --environment "file:///tmp/${NAME}-env.json" 2>/dev/null; then
    
    "${AWS_CMD[@]}" lambda update-function-code --function-name "$NAME" --zip-file "fileb://${ZIP_PATH}" >/dev/null
    "${AWS_CMD[@]}" lambda update-function-configuration --function-name "$NAME" --environment "file:///tmp/${NAME}-env.json" >/dev/null
  fi
}

# ── Lambda Functions ────────────────────────────────────────────────────────
echo "📦 Deploying Lambda functions"
for FN in "GroupsFunction" "ExpensesFunction" "ReceiptsFunction" "AnalyticsFunction" "ProfileFunction" "AuthTriggerFunction" "SnsWebhookFunction" "WsNotifierFunction" "HealthFunction"; do
  deploy_function "$FN" "index.handler"
  # Add global permission once per function to prevent redundant "updates" during route registration
  "${AWS_CMD[@]}" lambda add-permission --function-name "$FN" \
    --statement-id "apigw-global-${FN}" \
    --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:us-east-1:000000000000:*" \
    2>/dev/null || true
done

# ── REST API (v1) ──────────────────────────────────────────────────────────
echo "📦 Resolving REST API (idempotent — reuses existing)"
API_ID=$("${AWS_CMD[@]}" apigateway get-rest-apis --query "items[?name=='${API_NAME}'].id | [0]" --output text 2>/dev/null | tr -d '\r')
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$("${AWS_CMD[@]}" apigateway create-rest-api --name "$API_NAME" --query 'id' --output text | tr -d '\r')
  echo "  ↳ Created new API: ${API_ID}"
else
  echo "  ↳ Reusing existing API: ${API_ID}"
fi

ROOT_RES_ID=$("${AWS_CMD[@]}" apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/'].id | [0]" --output text)

# ── Helper: ensure a resource exists in the API Gateway tree ────────────────
# Creates nested resources (e.g., /groups/{id}/balances) by walking path segments.
ensure_resource() {
  local PARENT_ID=$1
  local PATH_PART=$2
  local FULL_PATH=$3

  local RES_ID
  RES_ID=$("${AWS_CMD[@]}" apigateway get-resources --rest-api-id "$API_ID" \
    --query "items[?path=='${FULL_PATH}'].id | [0]" --output text 2>/dev/null | tr -d '\r')

  if [ -z "$RES_ID" ] || [ "$RES_ID" = "None" ]; then
    RES_ID=$("${AWS_CMD[@]}" apigateway create-resource --rest-api-id "$API_ID" \
      --parent-id "$PARENT_ID" --path-part "$PATH_PART" --query 'id' --output text | tr -d '\r')
    echo "  ↳ Created resource: ${FULL_PATH} (${RES_ID})" >&2
  fi

  printf '%s' "$RES_ID"
}

# ── Helper: attach Lambda proxy integration to a resource ───────────────────
add_integration() {
  local RES_ID=$1
  local FUNCTION=$2

  for METHOD in GET POST PUT PATCH DELETE; do
    "${AWS_CMD[@]}" apigateway put-method --rest-api-id "$API_ID" --resource-id "$RES_ID" \
      --http-method "$METHOD" --authorization-type "NONE" 2>/dev/null || true
    "${AWS_CMD[@]}" apigateway put-integration --rest-api-id "$API_ID" --resource-id "$RES_ID" \
      --http-method "$METHOD" --type AWS_PROXY --integration-http-method POST \
      --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION}/invocations" 2>/dev/null || true
  done

  # Permissions are now handled once per function in the deployment phase
  return 0
}

# ── Register a full path with a Lambda (creates resource tree automatically) ─
add_route() {
  local ROUTE_PATH=$1
  local FUNCTION=$2

  # Split path into segments and walk the resource tree
  local PARENT_ID="$ROOT_RES_ID"
  local CURRENT_PATH=""
  local OLDIFS="$IFS"
  IFS='/'
  for SEG in $ROUTE_PATH; do
    [ -z "$SEG" ] && continue
    CURRENT_PATH="${CURRENT_PATH}/${SEG}"
    PARENT_ID=$(ensure_resource "$PARENT_ID" "$SEG" "$CURRENT_PATH")
  done
  IFS="$OLDIFS"

  add_integration "$PARENT_ID" "$FUNCTION"
  echo "  ↳ Route ${ROUTE_PATH} → ${FUNCTION}"
}

# ── Register all routes (must match server.ts + README API definitions) ─────
echo "📦 Registering API routes"
# Groups (6 routes)
add_route /groups GroupsFunction
add_route /groups/{id} GroupsFunction
add_route /groups/{id}/balances GroupsFunction
add_route /groups/{id}/members GroupsFunction
add_route /groups/{id}/members/{userId} GroupsFunction
add_route /groups/{id}/settle GroupsFunction

# Expenses (3 routes — sub-paths share one resource)
add_route /expenses ExpensesFunction
add_route /expenses/{id} ExpensesFunction
add_route /expenses/export ExpensesFunction

# Receipts (3 routes)
add_route /receipts ReceiptsFunction
add_route /receipts/upload-url ReceiptsFunction
add_route /receipts/{expenseId}/scan ReceiptsFunction
add_route /receipts/{expenseId}/download ReceiptsFunction

# Analytics (4 routes)
add_route /analytics AnalyticsFunction
add_route /analytics/summary AnalyticsFunction
add_route /analytics/trends AnalyticsFunction
add_route /analytics/chart-data AnalyticsFunction

# Profile (2 routes)
add_route /profile ProfileFunction

# Health (1 route)
add_route /health HealthFunction

# ── CORS ────────────────────────────────────────────────────────────────────
echo "📦 Configuring CORS via Enforcer"
bash "$(dirname "$0")/enable-cors.sh" "$API_ID"

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "📦 Deploying API"
"${AWS_CMD[@]}" apigateway create-deployment --rest-api-id "$API_ID" --stage-name local >/dev/null 2>&1 || true

echo "✅✅✅ Bootstrap complete!"
echo "  VITE_API_URL=http://localhost:4566/restapis/${API_ID}/local/_user_request_"
