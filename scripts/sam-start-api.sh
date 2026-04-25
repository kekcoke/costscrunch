#!/usr/bin/env bash
# ─── Costscrunch — SAM local API with dynamic Cognito IDs ────────────────────
# Sources .cognito.env and runs SAM with the correct User Pool/Client IDs.
#
# Usage:
#   ./scripts/sam-start-api.sh              # x64 template
#   ./scripts/sam-start-api.sh --arm64      # ARM64 template
#   ./scripts/sam-start-api.sh --watch      # with --watch flag
#
# Prerequisites:
#   1. docker compose -f infrastructure/docker-compose.localstack.yml up -d
#   2. Wait for localstack-cognito to complete (~30s)

set -euo pipefail

# Load dynamic Cognito IDs from provisioning
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COGNITO_ENV="$PROJECT_ROOT/.cognito.env"

if [ -f "$COGNITO_ENV" ]; then
    echo "↳ Loading Cognito IDs from $COGNITO_ENV"
    set -a
    source "$COGNITO_ENV"
    set +a
else
    echo "⚠️  .cognito.env not found - using defaults (LocalPool/LocalClient)"
    export COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-LocalPool}"
    export COGNITO_USER_POOL_CLIENT_ID="${COGNITO_USER_POOL_CLIENT_ID:-LocalClient}"
fi

echo "   User Pool ID:    ${COGNITO_USER_POOL_ID}"
echo "   User Pool Client: ${COGNITO_USER_POOL_CLIENT_ID}"

# Parse arguments
TEMPLATE="template-x64.yaml"
WATCH_FLAG=""

for arg in "$@"; do
    case $arg in
        --arm64)
            TEMPLATE="template-arm.yaml"
            ;;
        --watch)
            WATCH_FLAG="--watch"
            ;;
        *)
            echo "Unknown option: $arg"
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT/infrastructure/sam"

sam local start-api \
    --template "$TEMPLATE" \
    --env-vars env.json \
    --docker-network costscrunch-local \
    --port 4000 \
    $WATCH_FLAG
