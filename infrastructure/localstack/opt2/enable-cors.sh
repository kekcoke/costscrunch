#!/usr/bin/env bash
# ─── CostsCrunch — Robust API Gateway CORS Enforcer ──────────────────────────
# Ensures every resource in a REST API has valid OPTIONS/CORS config.

set -euo pipefail

API_ID=${1:-}
if [ -z "$API_ID" ]; then
  echo "Usage: $0 <api-id>"
  exit 1
fi

AWS="/usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1"
# Header values must be wrapped in single quotes inside the JSON string for static mapping
ORIGIN="'*'"
METHODS="'GET,POST,PUT,PATCH,DELETE,OPTIONS'"
HEADERS="'Content-Type,Authorization,X-Requested-With,Accept,Origin'"

echo "🌐 Enforcing CORS for API: $API_ID"

# Get all resources
RESOURCES=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query 'items[].id' --output text)

for RES_ID in $RESOURCES; do
  PATH=$($AWS apigateway get-resources --rest-api-id "$API_ID" --query "items[?id=='$RES_ID'].path" --output text)
  echo "  🚀 Configuring Path: $PATH ($RES_ID)"

  # 1. Ensure OPTIONS method exists
  $AWS apigateway put-method \
    --rest-api-id "$API_ID" \
    --resource-id "$RES_ID" \
    --http-method OPTIONS \
    --authorization-type "NONE" >/dev/null 2>&1 || true

  # 2. Set MOCK integration
  $AWS apigateway put-integration \
    --rest-api-id "$API_ID" \
    --resource-id "$RES_ID" \
    --http-method OPTIONS \
    --type MOCK \
    --request-templates '{"application/json": "{\"statusCode\": 200}"}' >/dev/null 2>&1 || true

  # 3. Define Method Response headers
  $AWS apigateway put-method-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RES_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": true,
      \"method.response.header.Access-Control-Allow-Methods\": true,
      \"method.response.header.Access-Control-Allow-Headers\": true
    }" >/dev/null 2>&1 || true

  # 4. Map static values in Integration Response (Critical fix: Added double quotes around variables)
  $AWS apigateway put-integration-response \
    --rest-api-id "$API_ID" \
    --resource-id "$RES_ID" \
    --http-method OPTIONS \
    --status-code 200 \
    --response-parameters "{
      \"method.response.header.Access-Control-Allow-Origin\": \"$ORIGIN\",
      \"method.response.header.Access-Control-Allow-Methods\": \"$METHODS\",
      \"method.response.header.Access-Control-Allow-Headers\": \"$HEADERS\"
    }" >/dev/null 2>&1 || true
done

echo "📦 Creating fresh deployment for stage 'local'..."
$AWS apigateway create-deployment --rest-api-id "$API_ID" --stage-name local >/dev/null

echo "✅ CORS enforcement complete."
