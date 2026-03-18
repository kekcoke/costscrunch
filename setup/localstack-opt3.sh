#!/usr/bin/env bash
# Init script for Option 3 (SAM CLI local — Lambda on host, data in LocalStack).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 1. Start LocalStack (data layer only)
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d

# 2. Wait for data seed to complete
until docker exec costscrunch-localstack-seed echo "✅✅✅ LocalStack seed complete!" >/dev/null 2>&1; do
  sleep 20
done

# 3. Build SAM artifacts
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

# 4. Start local API (Lambda on host, proxying data to LocalStack)
# Frontend connects to http://localhost:3001
export VITE_API_URL="http://localhost:3001"
echo "🌐 VITE_API_URL=$VITE_API_URL (run 'cd frontend && npm run dev' in a second terminal)"

sam local start-api \
  --template-file "$TEMPLATE" \
  --env-vars env.json \
  --port 3001
