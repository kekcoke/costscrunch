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
  # Check if our main DynamoDB table exists and has data
  if $AWS dynamodb describe-table --table-name "costscrunch-dev-main" >/dev/null 2>&1; then
    echo "   ✅ Data layer verified."
    break
  fi
  [ $i -eq $MAX_SYNC_RETRIES ] && echo "❌ Data layer sync timed out." && exit 1
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
    2>/dev/null && echo "  ✅ $NAME created" || echo "  ↳ $NAME already exists, updating..."

  $AWS lambda update-function-code \
    --function-name "$NAME" \
    --zip-file "fileb://${ZIP_PATH}" \
    2>/dev/null || true

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

# ── SNS Subscription ────────────────────────────────────────────────────────
echo "📦 Subscribing SnsWebhookFunction to Textract topic"
$AWS sns subscribe \
  --topic-arn "arn:aws:sns:us-east-1:000000000000:costscrunch-dev-textract-completion" \
  --protocol lambda \
  --notification-endpoint "arn:aws:lambda:us-east-1:000000000000:function:SnsWebhookFunction" \
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
  local METHOD=$1
  local ROUTE_PATH=$2
  local FUNCTION=$3

  # Simple path mapping: creating resources one level deep or proxy
  # For local dev simplicity, we create a proxy resource for each top-level path
  local PATH_PART=${ROUTE_PATH#/}
  PATH_PART=${PATH_PART%%/*}
  
  # Use tr -d '\r' to ensure clean variable values from aws cli output
  local RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/$PATH_PART'].id | [0]" --output text | tr -d '\r')
  if [ "$RES_ID" = "None" ] || [ -z "$RES_ID" ]; then
    # Use a small sleep to avoid "Too Many Requests" errors during rapid creation
    sleep 0.5
    RES_ID=$($AWS apigateway create-resource --rest-api-id "$API_ID" --parent-id "$ROOT_RES_ID" --path-part "$PATH_PART" --query 'id' --output text 2>/dev/null | tr -d '\r')
    # If it still failed, try to fetch it one last time (might have been created by race)
    if [ -z "$RES_ID" ]; then
        RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/$PATH_PART'].id | [0]" --output text | tr -d '\r')
    fi
  fi

  # If it has a subpath or variable, create a proxy {proxy+}
  if [[ "$PATH" == *"{"* ]] || [[ "$PATH" == */*/* ]]; then
    local PROXY_RES_ID=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?path=='/$PATH_PART/{proxy+}'].id | [0]" --output text | tr -d '\r')
    if [ "$PROXY_RES_ID" = "None" ] || [ -z "$PROXY_RES_ID" ]; then
      PROXY_RES_ID=$($AWS apigateway create-resource --rest-api-id "$API_ID" --parent-id "$RES_ID" --path-part "{proxy+}" --query 'id' --output text | tr -d '\r')
    fi
    RES_ID=$PROXY_RES_ID
    METHOD="ANY"
  fi

  $AWS apigateway put-method --rest-api-id "$API_ID" --resource-id "$RES_ID" --http-method "$METHOD" --authorization-type "NONE" 2>/dev/null || true
  
  $AWS apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$RES_ID" \
    --http-method "$METHOD" \
    --type AWS_PROXY \
    --integration-http-method POST \
    --uri "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:${FUNCTION}/invocations" \
    2>/dev/null || true

  $AWS lambda add-permission \
    --function-name "$FUNCTION" \
    --statement-id "api-${API_ID}-${RES_ID}-${METHOD}" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:us-east-1:000000000000:${API_ID}/*" \
    2>/dev/null || true
}

echo "📦 Creating routes"
add_route ANY /groups GroupsFunction
add_route ANY /expenses ExpensesFunction
add_route ANY /receipts ReceiptsFunction
add_route ANY /analytics AnalyticsFunction

# ── CORS ────────────────────────────────────────────────────────────────────
echo "📦 Configuring CORS"
# Each OPTIONS mock must return Access-Control headers. Without the integration
# response / method response blocks below, API GW returns 200 but zero CORS headers.
ALLOW_ORIGIN="http://localhost:3000,http://localhost:3001"
ALLOW_METHODS="GET,POST,PUT,PATCH,DELETE,OPTIONS"
ALLOW_HEADERS="Content-Type,Authorization,X-Requested-With,Accept,Origin"

for RES in $($AWS apigateway get-resources --rest-api-id "$API_ID" --query 'items[].id' --output text); do
  $AWS apigateway put-method \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --authorization-type "NONE" 2>/dev/null || true

  $AWS apigateway put-integration \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --type MOCK \
    --request-templates '{"application/json": "{\"statusCode\": 200}"}' \
    2>/dev/null || true

  # Tell API GW to return the CORS headers on the 200 response
  $AWS apigateway put-integration-response \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --status-code 200 \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": \"'$ALLOW_ORIGIN'\",
      \"method.response.header.Access-Control-Allow-Methods\": \"'$ALLOW_METHODS'\",
      \"method.response.header.Access-Control-Allow-Headers\": \"'$ALLOW_HEADERS'\"
    }" \
    2>/dev/null || true

  # Register the 200 + headers as a valid method response
  $AWS apigateway put-method-response \
    --rest-api-id "$API_ID" --resource-id "$RES" \
    --http-method OPTIONS --status-code 200 \
    --response-models '{"application/json": "Empty"}' \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": false,
      \"method.response.header.Access-Control-Allow-Methods\": false,
      \"method.response.header.Access-Control-Allow-Headers\": false
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
