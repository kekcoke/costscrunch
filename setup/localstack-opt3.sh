#!/usr/bin/env bash
# Init script for Option 3 (SAM CLI local — Lambda on host, data in LocalStack).

set -euo pipefail

# CONFIG
ENV_NAME="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 1. Load and expand env variables from .env.dev
ENV_FILE="$PROJECT_ROOT/.env.dev"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.dev not found at $ENV_FILE"
  exit 1
fi

echo "🔧 Loading environment: $ENV_NAME"

# Load variables and perform recursive expansion
while read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^\s*# ]] && continue
  [[ -z "$line" ]] && continue
  key=$(echo "$line" | cut -d '=' -f 1 | xargs)
  value=$(echo "$line" | cut -d '=' -f 2- | xargs)
  eval "export $key=\"$value\""
done < "$ENV_FILE"

# Second pass for nested variables
for i in {1..3}; do
  while read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^\s*# ]] && continue
    [[ -z "$line" ]] && continue
    key=$(echo "$line" | cut -d '=' -f 1 | xargs)
    eval "export $key=\"${!key}\""
  done < "$ENV_FILE"
done

# 2. Generate env.json for SAM
# Note: To ensure ALL functions get these, we map them to individual function names 
# and the "Parameters" block (for templates that use Ref).
cat <<EOF > "$PROJECT_ROOT/infrastructure/sam/env.json"
{
  "Parameters": {
    "AWS_ENDPOINT_URL": "${AWS_ENDPOINT_URL}",
    "AWS_ACCESS_KEY_ID": "${AWS_ACCESS_KEY_ID}",
    "AWS_SECRET_ACCESS_KEY": "${AWS_SECRET_ACCESS_KEY}",
    "AWS_REGION": "${AWS_REGION}",
    "MOCK_AUTH": "${MOCK_AUTH}",
    "ENVIRONMENT": "${ENVIRONMENT}",
    "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
    "TABLE_NAME_CONNECTIONS": "${TABLE_NAME_CONNECTIONS}",
    "EVENT_BUS_NAME": "${EVENT_BUS_NAME}",
    "AWS_ENDPOINT_URL": "http://host.docker.internal:4566"
  },
  "GroupsFunction": { "ENVIRONMENT": "${ENVIRONMENT}", "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}" },
  "ExpensesFunction": { "ENVIRONMENT": "${ENVIRONMENT}", "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}" },
  "ReceiptsFunction": { "ENVIRONMENT": "${ENVIRONMENT}", "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}" },
  "AnalyticsFunction": { "ENVIRONMENT": "${ENVIRONMENT}", "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}" },
  "HealthFunction": { "ENVIRONMENT": "${ENVIRONMENT}", "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}" }
}
EOF

# 3. Start LocalStack
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d

# 4. Wait for data seed
until docker exec costscrunch-localstack-seed echo "✅✅✅ LocalStack seed complete!" >/dev/null 2>&1; do
  sleep 20
done

# 5. Build SAM artifacts
cd "$PROJECT_ROOT/infrastructure/sam"
ARCH=$(uname -m)
TEMPLATE=$([ "$ARCH" = "arm64" ] && echo "template-arm.yaml" || echo "template-x64.yaml")
echo "🔧 Using SAM template: $TEMPLATE (arch: $ARCH)"

export PATH="$PROJECT_ROOT/backend/node_modules/.bin:$PATH"
sam build --template-file "$TEMPLATE"

# 6. Start local API
export VITE_API_URL="http://localhost:3001"
cd "$PROJECT_ROOT/frontend" && npm run dev &

sam local start-api \
  --template-file ".aws-sam/build/template.yaml" \
  --env-vars env.json \
  --port 3001 \
  --container-host host.docker.internal
