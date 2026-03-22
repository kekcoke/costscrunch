#!/usr/bin/env bash
# Init script for Option 3 (SAM CLI local — Lambda in Docker, data in LocalStack).
#
# Networking: --docker-network mode — Lambda containers join costscrunch-local
#   and resolve LocalStack by container name (costscrunch-localstack:4566).
#   This bypasses SAM CLI v1.155+ --container-host socket.gaierror bug.
#
# Env vars: template-arm.yaml Globals are the single source of truth for shared
#   vars. env.json provides per-function overrides only (e.g. MOCK_AUTH).
#   After generation, env.json is validated against expected keys.
#
# ⚠️  OPT2 IMPACT: This script and template-arm.yaml changes do NOT affect opt2.
#   Opt2 uses its own bootstrap.sh with independent env vars and never reads
#   template-arm.yaml. Opt2 Lambdas run inside the LocalStack container and
#   use http://localstack:4566 (internal DNS), not the Docker network.

set -euo pipefail

# ── P1-4: Trap-based cleanup — kills background jobs on Ctrl+C/exit ───────
cleanup() {
  echo ""
  echo "🛑 Shutting down opt3..."
  kill $(jobs -p) 2>/dev/null || true
  wait $(jobs -p) 2>/dev/null || true
  echo "✅ Stopped"
}
trap cleanup EXIT INT TERM

# CONFIG
ENV_NAME="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_PORT=3001
FRONTEND_PORT=3000
NETWORK_NAME="costscrunch-local"
LOCALSTACK_HOST="costscrunch-localstack"

# ── P0-1: SAM CLI version check ────────────────────────────────────────────
if ! command -v sam &>/dev/null; then
  echo "❌ SAM CLI not found. Install: brew install aws-sam-cli"
  exit 1
fi
SAM_VERSION=$(sam --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)
if [ "$(printf '%s\n' "1.155" "$SAM_VERSION" | sort -V | head -1)" = "1.155" ]; then
  echo "⚠️  SAM CLI v$SAM_VERSION detected — known --container-host bug in v1.155+"
  echo "   Using --docker-network workaround (safe)."
fi

# ── P1-5: Port conflict pre-check ──────────────────────────────────────────
for port in "$API_PORT" "$FRONTEND_PORT"; do
  if lsof -ti:"$port" >/dev/null 2>&1; then
    echo "❌ Port $port is already in use. Kill the process or change the port."
    echo "   Find process: lsof -i:$port"
    echo "   Kill:         lsof -ti:$port | xargs kill -9"
    exit 1
  fi
done

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
# P0-3: Template Globals are the single source of truth for shared env vars.
# env.json only provides per-function overrides that differ from Globals.
# NOTE: SAM CLI requires "EnvironmentVariables" wrapper per function.
ENDPOINT="http://${LOCALSTACK_HOST}:4566"
cat <<EOF > "$PROJECT_ROOT/infrastructure/sam/env.json"
{
  "Parameters": {
    "ENVIRONMENT": "${ENVIRONMENT}",
    "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
    "TABLE_NAME_CONNECTIONS": "${TABLE_NAME_CONNECTIONS}",
    "EVENT_BUS_NAME": "${EVENT_BUS_NAME}",
    "AWS_ENDPOINT_URL": "${ENDPOINT}"
  },
  "GroupsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "${ENDPOINT}",
      "DYNAMODB_ENDPOINT": "${ENDPOINT}",
      "MOCK_AUTH": "true"
    }
  },
  "ExpensesFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "${ENDPOINT}",
      "DYNAMODB_ENDPOINT": "${ENDPOINT}"
    }
  },
  "ReceiptsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "${ENDPOINT}",
      "DYNAMODB_ENDPOINT": "${ENDPOINT}",
      "S3_ENDPOINT": "${ENDPOINT}"
    }
  },
  "AnalyticsFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "${ENDPOINT}",
      "DYNAMODB_ENDPOINT": "${ENDPOINT}"
    }
  },
  "HealthFunction": {
    "EnvironmentVariables": {
      "ENVIRONMENT": "${ENVIRONMENT}",
      "TABLE_NAME_MAIN": "${TABLE_NAME_MAIN}",
      "AWS_ENDPOINT_URL": "${ENDPOINT}"
    }
  }
}
EOF

# ── P0-2: Validate env.json — catch missing/exp empty vars before SAM starts ─
ENV_JSON="$PROJECT_ROOT/infrastructure/sam/env.json"
if ! command -v jq &>/dev/null; then
  echo "⚠️  jq not found — skipping env.json validation (install: brew install jq)"
else
  ERRORS=0
  for fn in GroupsFunction ExpensesFunction ReceiptsFunction AnalyticsFunction HealthFunction; do
    ENV_VAL=$(jq -r ".\"${fn}\".EnvironmentVariables.ENVIRONMENT // \"MISSING\"" "$ENV_JSON")
    if [ "$ENV_VAL" = "MISSING" ] || [ -z "$ENV_VAL" ]; then
      echo "❌ env.json: ${fn} missing ENVIRONMENT"
      ERRORS=$((ERRORS + 1))
    fi
    EP_VAL=$(jq -r ".\"${fn}\".EnvironmentVariables.AWS_ENDPOINT_URL // \"MISSING\"" "$ENV_JSON")
    if [ "$EP_VAL" = "MISSING" ] || [ -z "$EP_VAL" ]; then
      echo "❌ env.json: ${fn} missing AWS_ENDPOINT_URL"
      ERRORS=$((ERRORS + 1))
    fi
  done
  if [ "$ERRORS" -gt 0 ]; then
    echo "❌ env.json validation failed ($ERRORS errors). Aborting."
    exit 1
  fi
  echo "✅ env.json validated (5 functions, all required keys present)"
fi

# 3. Start LocalStack
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d

# 4. Wait for data seed
echo "⏳ Waiting for LocalStack seed..."
SEED_ATTEMPTS=0
until docker exec costscrunch-localstack-seed echo "✅✅✅ LocalStack seed complete!" >/dev/null 2>&1; do
  SEED_ATTEMPTS=$((SEED_ATTEMPTS + 1))
  if [ "$SEED_ATTEMPTS" -gt 15 ]; then
    echo "❌ LocalStack seed timed out after $((SEED_ATTEMPTS * 20))s"
    echo "   Check logs: docker compose -f docker-compose.localstack.yml logs localstack-seed"
    exit 1
  fi
  sleep 20
done
echo "✅ LocalStack seeded"

# 5. Build SAM artifacts
cd "$PROJECT_ROOT/infrastructure/sam"
ARCH=$(uname -m)
TEMPLATE=$([ "$ARCH" = "arm64" ] && echo "template-arm.yaml" || echo "template-x64.yaml")
echo "🔧 Using SAM template: $TEMPLATE (arch: $ARCH)"

export PATH="$PROJECT_ROOT/backend/node_modules/.bin:$PATH"
sam build --template-file "$TEMPLATE"

# 6. Start frontend
export VITE_API_URL="http://localhost:${API_PORT}"
cd "$PROJECT_ROOT/frontend" && npm run dev &

# 7. Start SAM local API
# Docker network mode — Lambda containers join costscrunch-local network,
# resolving LocalStack by container name. Bypasses SAM v1.155+ socket.gaierror.
echo "🚀 Starting SAM local API on port $API_PORT..."
sam local start-api \
  --template-file ".aws-sam/build/template.yaml" \
  --env-vars env.json \
  --port "$API_PORT" \
  --docker-network "$NETWORK_NAME"
