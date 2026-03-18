#!/usr/bin/env bash
# Init script for Option 2 (LocalStack compute — no SAM required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🚀 [1/8] Starting base LocalStack (data layer)..."
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d
echo "   ↳ Containers started (detached)"

echo "⏳ [2/8] Waiting for LocalStack to be healthy..."
while true; do
  HEALTH=$(curl -sf http://localhost:4566/_localstack/health 2>/dev/null || true)
  echo "   ↳ health response: $HEALTH"
  MATCH=$(echo "$HEALTH" | LC_ALL=C grep -ac "available" || echo "0")
  if [ "$MATCH" -gt "0" ]; then
    break
  fi
  echo "   ↳ LocalStack not ready yet, retrying in 5s..."
  sleep 5
done
echo "   ✅ LocalStack healthy"

echo "⏳ [2b/8] Waiting for data seed to complete..."
echo "   ↳ (polling logs every 5s — seed container exits on completion)"
while true; do
  # Capture logs to variable first — avoids pipefail on docker logs exit code
  SEED_LOGS=$(docker logs costscrunch-localstack-seed 2>&1 || true)
  MATCH=$(echo "$SEED_LOGS" | LC_ALL=C grep -ac "LocalStack seed complete" || echo "0")
  echo "   ↳ debug: MATCH=$MATCH"
  if [ "$MATCH" -gt "0" ]; then
    break
  fi
  # Fail fast if seed exited non-zero
  SEED_STATUS=$(docker inspect costscrunch-localstack-seed --format '{{.State.ExitCode}}' 2>/dev/null || echo "")
  if [ -n "$SEED_STATUS" ] && [ "$SEED_STATUS" != "0" ]; then
    echo "❌ Seed container exited with error (exit code $SEED_STATUS). Check logs:"
    docker logs costscrunch-localstack-seed 2>&1 | tail -20
    exit 1
  fi
  echo "   ↳ Seed not complete yet, retrying in 5s..."
  sleep 5
done
echo "   ✅ Data seed complete"

echo "🚀 [3/8] Starting opt2 compute container..."
docker compose -f localstack/opt2/docker-compose.opt2.yml up -d

echo "⏳ [3b/8] Waiting for costscrunch-localstack container to accept exec..."
until docker exec costscrunch-localstack echo "container-ready" >/dev/null 2>&1; do
  echo "   ↳ Container not ready yet, retrying in 3s..."
  sleep 3
done
echo "   ✅ Container ready"

echo "🔨 [4/8] Building local Lambda bundles (esbuild)..."
cd "$PROJECT_ROOT/backend"
npm run build:local
echo "   ✅ Lambda bundles built"

echo "📦 [5/8] Copying bootstrap script and build artifacts into container..."
docker exec costscrunch-localstack mkdir -p /opt/bootstrap
docker exec costscrunch-localstack mkdir -p /opt/lambda-build
docker cp "$PROJECT_ROOT/infrastructure/localstack/opt2/bootstrap.sh" costscrunch-localstack:/opt/bootstrap/bootstrap.sh
docker cp "$PROJECT_ROOT/backend/dist/lambda/." costscrunch-localstack:/opt/lambda-build
echo "   ✅ Artifacts copied"

echo "⚙️  [6/8] Running bootstrap inside container (IAM + Lambda + API GW)..."
docker exec costscrunch-localstack bash /opt/bootstrap/bootstrap.sh
echo "   ✅ Bootstrap complete"

echo "🔍 [7/8] Fetching API_ID from LocalStack..."
sleep 2  # brief settle time after bootstrap
API_ID=$(aws --endpoint-url=http://localhost:4566 --region us-east-1 \
  --no-cli-pager \
  apigatewayv2 get-apis \
  --query "Items[?Name=='costscrunch-dev-api'].ApiId | [0]" \
  --output text 2>/dev/null || echo "")

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  echo "   ⚠️  First attempt failed, retrying in 5s..."
  sleep 5
  API_ID=$(aws --endpoint-url=http://localhost:4566 --region us-east-1 \
    --no-cli-pager \
    apigatewayv2 get-apis \
    --query "Items[?Name=='costscrunch-dev-api'].ApiId | [0]" \
    --output text 2>/dev/null || echo "")
fi

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  echo "❌ Could not fetch API_ID from LocalStack."
  echo "   Debug: listing all APIs..."
  aws --endpoint-url=http://localhost:4566 --region us-east-1 --no-cli-pager \
    apigatewayv2 get-apis --output table 2>/dev/null || echo "   (aws CLI not available on host)"
  exit 1
fi

export VITE_API_URL="http://localhost:4566/restapis/${API_ID}/local/_user_request_"
echo "   ✅ API_ID=$API_ID"
echo "   ✅ VITE_API_URL=$VITE_API_URL"

echo "🌐 [8/8] Starting frontend..."
cd "$PROJECT_ROOT/frontend"
VITE_API_URL="$VITE_API_URL" npm run dev
