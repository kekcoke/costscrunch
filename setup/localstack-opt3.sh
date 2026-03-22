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
# CRITICAL: AWS SDK v3 handles endpoints differently. 
# We set AWS_ENDPOINT_URL and also specific ones just in case.
# Docker network mode: Lambda containers resolve LocalStack by container name.
# NOTE: --docker-network bypasses SAM's broken socket connection in v1.155+.
# SAM CLI requires env vars nested under "EnvironmentVariables" per function.
cat <<EOF > "$PROJECT_ROOT/infrastructure/sam/env.json"
{
  "Parameters": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
    "TABLE_NAME_CONNECTIONS": "${TABLE_NAME_CONNECTIONS}",
    "EVENT_BUS_NAME": "${EVENT_BUS_NAME}",
    "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566"
  },
  "GroupsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566",
      "DYNAMODB_ENDPOINT": "http://costscrunch-localstack:4566",
      "MOCK_AUTH": "true"
    }
  },
  "ExpensesFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566",
      "DYNAMODB_ENDPOINT": "http://costscrunch-localstack:4566"
    }
  },
  "ReceiptsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566",
      "DYNAMODB_ENDPOINT": "http://costscrunch-localstack:4566",
      "S3_ENDPOINT": "http://costscrunch-localstack:4566"
    }
  },
  "AnalyticsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566",
      "DYNAMODB_ENDPOINT": "http://costscrunch-localstack:4566"
    }
  },
  "HealthFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "http://costscrunch-localstack:4566"
    }
  }
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

# Docker network mode — Lambda containers join the same network as LocalStack,
# resolving it by container name. Bypasses SAM v1.155+ socket.gaierror bug.
sam local start-api \
  --template-file ".aws-sam/build/template.yaml" \
  --env-vars env.json \
  --port 3001 \
  --docker-network costscrunch-local
