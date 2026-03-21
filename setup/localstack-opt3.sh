#!/usr/bin/env bash
# Init script for Option 3 (SAM CLI local — Lambda on host, data in LocalStack).

set -euo pipefail

# CONFIG
ENV_NAME="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 1. Load and expand env variables from .env.dev
# We use a subshell to safely evaluate the variables (handling ${PREFIX} etc.)
ENV_FILE="$PROJECT_ROOT/.env.dev"
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.dev not found at $ENV_FILE"
  exit 1
fi

# Export variables to the current shell for the heredoc expansion below
# echo "---- GENERATED SCRIPT ----"
# grep -v '^#' "$ENV_FILE" | sed -E 's/^([^=]+)=(.*)$/\1="\2"/'
# echo "--------------------------"

# set -a
# source <(grep -v '^#' "$ENV_FILE" | sed -E 's/^([^=]+)=(.*)$/\1="\2"/')
# set +a

echo "🔧 Loading environment: $ENV_NAME"

# Load raw vars (no expansion yet)
while IFS='=' read -r key value || [[ -n "$key" ]]; do
  # Skip comments and empty lines
  [[ "$key" =~ ^\s*# ]] && continue
  [[ -z "$key" ]] && continue

  # Trim whitespace
  key="$(echo "$key" | xargs)"
  value="$(echo "$value" | xargs)"

  export "$key=$value"
done < "$ENV_FILE"

# Expand vars
for key in $(grep -v '^#' "$ENV_FILE" | cut -d= -f1); do
  # Skip empty keys
  [[ -z "$key" ]] && continue

  # Expand thru indirect expansion
  eval "export $key=\"${!key}\""
done

# Allow run-time overrides (optional)
# Example ./sh env API_URL=...
shift || true
for arg in "$@"; do
  if [[ "$arg" == *=* ]]; then
    export "$arg"
  fi
done

# Debug
echo "✅ Loaded variables:"
env | grep -E '^(API_URL|BASE_URL|AWS_)' || true


# 2. Generate env.json for SAM using the expanded variables
# Note: "Parameters" applies these to all functions in the template
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
    "FROM_EMAIL": "${FROM_EMAIL}",
    "BUCKET_UPLOADS_NAME": "${BUCKET_UPLOADS_NAME}",
    "BUCKET_PROCESSED_NAME": "${BUCKET_PROCESSED_NAME}",
    "BUCKET_RECEIPTS_NAME": "${BUCKET_RECEIPTS_NAME}",
    "TEXTRACT_SNS_TOPIC_ARN": "${TEXTRACT_SNS_TOPIC_ARN}",
    "TEXTRACT_ROLE_ARN": "${TEXTRACT_ROLE_ARN}",
    "EVENT_BUS_NAME": "${EVENT_BUS_NAME}"
  }
}
EOF

# 3. Start LocalStack (data layer only)
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d

# 4. Wait for data seed to complete
until docker exec costscrunch-localstack-seed echo "✅✅✅ LocalStack seed complete!" >/dev/null 2>&1; do
  sleep 20
done

# 5. Build SAM artifacts
cd "$PROJECT_ROOT/infrastructure/sam"

# Detect host architecture → select matching SAM template
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  TEMPLATE="template-arm.yaml"
else
  TEMPLATE="template-x64.yaml"
fi
echo "🔧 Using SAM template: $TEMPLATE (arch: $ARCH)"

# SAM's esbuild bundler requires esbuild on PATH — use the one from backend devDependencies
export PATH="$PROJECT_ROOT/backend/node_modules/.bin:$PATH"

sam build --template-file "$TEMPLATE"

# 6. Start local API (Lambda on host, proxying data to LocalStack)
# Frontend connects to http://localhost:3001
export VITE_API_URL="http://localhost:3001"
echo "🌐 VITE_API_URL=$VITE_API_URL"
echo "Starting frontend..."

cd "$PROJECT_ROOT/frontend" && npm run dev &

# Use the built template so SAM finds the transpiled index.js in .aws-sam/build/
sam local start-api \
  --template-file ".aws-sam/build/template.yaml" \
  --env-vars env.json \
  --port 3001
