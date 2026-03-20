#!/usr/bin/env bash
# ─── CostsCrunch — LocalStack Lambda + API GW Bootstrap (v1 REST API) ──────
# Runs inside LocalStack container via init/ready.d/ after services are healthy.
# Works together with setup.sh (data seeding) — this script handles compute only.
#
# Prerequisites:
#   - setup.sh has already seeded DynamoDB, S3, SSM parameters
#   - Lambda build artifacts exist at /opt/lambda-build/
#
# This script creates:
#   IAM execution role, 6 Lambda functions, REST API (v1), resources, methods, integrations, CORS, SNS subscription

set -euo pipefail

# Use absolute path to avoid "command not found" in some container environments
AWS="/usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1"
API_NAME="costscrunch-dev-api"
ROLE_NAME="costscrunch-dev-lambda-role"
LAMBDA_BUILD="/opt/lambda-build"

echo "🔧 Lambda + API GW bootstrap starting..."

# ── Sync: Wait for data seed to be visible inside LocalStack ────────────────
# This ensures that compute resources are created only after the data layer is stable.
echo "⏳ Waiting for data layer to be ready (seed verification)..."
MAX_SYNC_RETRIES=30
for i in $(seq 1 $MAX_SYNC_RETRIES); do
  if $AWS dynamodb describe-table --table-name "costscrunch-dev-main" >/dev/null 2>&1; then
    echo "   ✅ Data layer verified."
    break
  fi
  [ $i -eq $MAX_SYNC_RETRIES ] && echo "❌ Data layer sync timed out." && exit 1
  sleep 2
done

# ── Sync: Wait for Lambda service to be fully initialized ─────────────────────
# LocalStack Lambda registry can take time to start accepting create-function calls.
echo "⏳ Waiting for Lambda service to be ready..."
for i in $(seq 1 20); do
  if $AWS lambda list-functions --output json 2>/dev/null | grep -q "Functions"; then
    echo "   ✅ Lambda service ready."
    break
  fi
  [ $i -eq 20 ] && echo "   ↳ Lambda service may still be initializing (proceeding anyway)..."
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
echo "  ↳ Role ARN: $ROLE_ARN"

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
  if [ ! -f "$ZIP_PATH" ]; then
    echo "  ❌ Failed to create zip file at $ZIP_PATH"
    return 1
  fi

  # Write env vars to a temp file — avoids JSON quoting issues in --environment
  # The file must contain the full Environment structure for the --environment flag
  cat > /tmp/${NAME}-env.json << 'ENVEOF'
{
  "Variables": {
    "AWS_ENDPOINT_URL": "http://localstack:4566",
    "AWS_ACCESS_KEY_ID": "test",
    "AWS_SECRET_ACCESS_KEY": "test",
    "AWS_REGION": "us-east-1",
    "MOCK_AUTH": "true",
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
ENVEOF

  echo "  ↳ Creating Lambda function $NAME"
  if ! $AWS lambda create-function \
    --function-name "$NAME" \
    --runtime nodejs20.x \
    --handler "$HANDLER" \
    --role "$ROLE_ARN" \
    --zip-file "fileb://${ZIP_PATH}" \
    --environment "file:///tmp/${NAME}-env.json" 2>/dev/null; then
    echo "  ↳ $NAME creation failed (likely already exists), attempting update..."
  else
    echo "  ✅ $NAME created"
  fi

  # Sync: wait for Lambda to be registered before update/add-permission calls
  for i in $(seq 1 10); do
    $AWS lambda get-function --function-name "$NAME" >/dev/null 2>&1 && break
    sleep 1
  done

  $AWS lambda update-function-code \
    --function-name "$NAME" \
    --zip-file "fileb://${ZIP_PATH}" \
    2>/dev/null || true

  $AWS lambda update-function-configuration \
    --function-name "$NAME" \
    --environment "file:///tmp/${NAME}-env.json" \
    2>/dev/null || true

  # Sync: wait for code update to complete
  for i in $(seq 1 15); do
    STATE=$($AWS lambda get-function-configuration --function-name "$NAME" \
      --query 'LastUpdateStatus' --output text 2>/dev/null || echo "Pending")
    [ "$STATE" = "Successful" ] && break
    sleep 1
  done

  # Final check: ensure function is Active
  for i in $(seq 1 10); do
    STATE=$($AWS lambda get-function-configuration --function-name "$NAME" \
      --query 'State' --output text 2>/dev/null || echo "Pending")
    [ "$STATE" = "Active" ] && break
    sleep 1
  done

  # rm -f "$ZIP_PATH"  # Keep zip for debugging if needed
}

# ── Lambda Functions ────────────────────────────────────────────────────────
echo "📦 Deploying Lambda functions"
# Note: Using index.handler which corresponds to the bundled entry point.
# Ensure MOCK_AUTH=true is set in the environment (done in deploy_function).
deploy_function "GroupsFunction"      "index.handler"
deploy_function "ExpensesFunction"    "index.handler"
deploy_function "ReceiptsFunction"    "index.handler"
deploy_function "AnalyticsFunction"   "index.handler"
deploy_function "SnsWebhookFunction"  "index.handler"
deploy_function "WsNotifierFunction"  "index.handler"
deploy_function "HealthFunction"      "index.handler"

# ── SNS Subscription ────────────────────────────────────────────────────────
echo "📦 Subscribing ScanQueue to Textract topic"
$AWS sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract-completion" \
  --protocol sqs \
  --notification-endpoint "arn:aws:sqs:us-east-1:000000000000:costscrunch-dev-scan-queue" \
  2>/dev/null || true

# ── Lambda Event Source Mapping (SQS -> Lambda) ──────────────────────────────
echo "📦 Mapping ScanQueue to SnsWebhookFunction"
$AWS lambda create-event-source-mapping \
  --function-name "SnsWebhookFunction" \
  --event-source-arn "arn:aws:sqs:us-east-1:000000000000:costscrunch-dev-scan-queue" \
  --batch-size 1 \
  2>/dev/null || true

# ── REST API (v1) ──────────────────────────────────────────────────────────
echo "📦 Creating REST API"
API_ID=$($AWS apigateway create-rest-api \
  --name "$API_NAME" \
  --endpoint-configuration types=REGIONAL \
  --query 'id' \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  API_ID=$($AWS apigateway get-rest-apis \
    --query "items[?name=='${API_NAME}'].id | [0]" \
    --output text)
  echo "  ↳ Existing API: $API_ID"
else
  echo "  ✅ Created API: $API_ID"
fi

ROOT_RES_ID=$($AWS apigateway get-resources \
  --rest-api-id "$API_ID" \
  --query "items[?path=='/'].id | [0]" \
  --output text)

# ── Helper: add route ───────────────────────────────────────────────────────
add_route() {
  local ROUTE_PATH=$1
  local FUNCTION=$2

  # Strip leading slash and extract first path segment
  local PATH_PART=${ROUTE_PATH#/}
  PATH_PART=${PATH_PART%%/*}

  # Get or create the resource
  local RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" \
    --query "items[?path=='/$PATH_PART'].id | [-1]" --output text 2>/dev/null | tr -d '\r')
  if [ -z "$RES_ID" ] || [ "$RES_ID" = "None" ]; then
    sleep 0.5
    RES_ID=$($AWS apigateway create-resource --rest-api-id "$API_ID" \
      --parent-id "$ROOT_RES_ID" --path-part "$PATH_PART" \
      --query 'id' --output text 2>/dev/null | tr -d '\r')
    [ -z "$RES_ID" ] && RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" \
      --query "items[?path=='/$PATH_PART'].id | [-1]" --output text 2>/dev/null | tr -d '\r')
  fi

  # Create proxy resource for deep paths (e.g. /groups/{id})
  if [[ "$ROUTE_PATH" == */*/* ]]; then
    local PROXY_RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" \
      --query "items[?path=='/$PATH_PART/{proxy+}'].id | [-1]" --output text 2>/dev/null | tr -d '\r')
    if [ -z "$PROXY_RES_ID" ] || [ "$PROXY_RES_ID" = "None" ]; then
      PROXY_RES_ID=$($AWS apigateway create-resource --rest-api-id "$API_ID" \
        --parent-id "$RES_ID" --path-part "{proxy+}" \
        --query 'id' --output text 2>/dev/null | tr -d '\r')
    fi
    RES_ID=$PROXY_RES_ID
  fi

  # Add each HTTP method + Lambda integration
  for METHOD in $HTTP_METHODS; do
    $AWS apigateway put-method \
      --rest-api-id "$API_ID" --resource-id "$RES_ID" \
      --http-method "$METHOD" --authorization-type "NONE" \
      2>/dev/null || true

    $AWS apigateway put-integration \
      --rest-api-id "$API_ID" --resource-id "$RES_ID" \
      --http-method "$METHOD" --type AWS_PROXY \
      --integration-http-method POST \
      --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION}/invocations" \
      2>/dev/null || true

    # Ensure function exists before adding permission
    if $AWS lambda get-function --function-name "$FUNCTION" >/dev/null 2>&1; then
      $AWS lambda add-permission \
        --function-name "$FUNCTION" \
        --statement-id "api-$(date +%s)-${RES_ID}-${METHOD}" \
        --action lambda:InvokeFunction \
        --principal apigateway.amazonaws.com \
        --source-arn "arn:aws:execute-api:us-east-1:000000000000:${API_ID}/*" \
        2>/dev/null || true
    fi
  done
}

# NOTE: ANY is not a valid REST API method — only HTTP API (v2) supports it.
# We enumerate all real HTTP verbs so GET/POST/PUT/PATCH/DELETE all route to Lambda.
HTTP_METHODS="GET POST PUT PATCH DELETE"

echo "📦 Creating routes"
add_route /groups GroupsFunction
add_route /expenses ExpensesFunction
add_route /receipts ReceiptsFunction
add_route /analytics AnalyticsFunction
add_route /health    HealthFunction

# ── CORS ────────────────────────────────────────────────────────────────────
echo "📦 Configuring CORS"
ALLOW_ORIGIN="*"
ALLOW_METHODS="GET,POST,PUT,PATCH,DELETE,OPTIONS"
ALLOW_HEADERS="Content-Type,Authorization,X-Requested-With,Accept,Origin,X-Idempotency-Key"

# Global Gateway Responses for CORS (Catch-all for 4xx/5xx)
for TYPE in DEFAULT_4XX DEFAULT_5XX; do
  $AWS apigateway put-gateway-response \
    --rest-api-id "$API_ID" \
    --response-type "$TYPE" \
    --response-parameters "{
      \"gatewayresponse.header.Access-Control-Allow-Origin\": \"'$ALLOW_ORIGIN'\",
      \"gatewayresponse.header.Access-Control-Allow-Methods\": \"'$ALLOW_METHODS'\",
      \"gatewayresponse.header.Access-Control-Allow-Headers\": \"'$ALLOW_HEADERS'\"
    }" 2>/dev/null || true
done

for RES in $($AWS apigateway get-resources --rest-api-id "$API_ID" --query 'items[].id' --output text); do
  $AWS apigateway put-method \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --authorization-type "NONE" 2>/dev/null || true

  $AWS apigateway put-integration \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --type MOCK \
    --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
    2>/dev/null || true

  $AWS apigateway put-integration-response \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --status-code 200 \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": \"'$ALLOW_ORIGIN'\",
      \"method.response.header.Access-Control-Allow-Methods\": \"'$ALLOW_METHODS'\",
      \"method.response.header.Access-Control-Allow-Headers\": \"'$ALLOW_HEADERS'\"
    }" \
    2>/dev/null || true

  $AWS apigateway put-method-response \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --status-code 200 \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": true,
      \"method.response.header.Access-Control-Allow-Methods\": true,
      \"method.response.header.Access-Control-Allow-Headers\": true
    }" \
    2>/dev/null || true
done

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "📦 Deploying API"
$AWS apigateway create-deployment --rest-api-id "$API_ID" --stage-name local 2>/dev/null || true

API_URL="http://localhost:4566/restapis/${API_ID}/local/_user_request_"
echo ""
echo "✅✅✅ Lambda + API GW bootstrap complete!"
echo "  API endpoint: $API_URL"
echo "  VITE_API_URL=$API_URL"
