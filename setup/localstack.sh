#!/usr/bin/env bash
# Init script for Option 2 (LocalStack compute — no SAM required).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Unique run ID passed through to the seed container
export RUN_ID="$(date +%s)-$$"

echo "🧹 Cleaning up stale Lambda containers..."
# Only look for containers matching the LocalStack Lambda naming convention
STALE_CONTAINERS=$(docker ps -a --filter "name=costscrunch-localstack-lambda" --format "{{.ID}}" 2>/dev/null || echo "")
if [ -n "$STALE_CONTAINERS" ]; then
  echo "   ↳ Removing: $STALE_CONTAINERS"
  docker rm -f $STALE_CONTAINERS >/dev/null 2>&1 || true
else
  echo "   ↳ No stale containers found."
fi

echo "🚀 [1/8] Starting base LocalStack (data layer)..."
cd "$PROJECT_ROOT/infrastructure"

# Start LocalStack and the seed container
docker compose -f docker-compose.localstack.yml up -d
echo "   ↳ Containers started"

echo "⏳ [2/8] Waiting for LocalStack edge port..."
until curl -s http://localhost:4566/_localstack/health > /dev/null; do
  echo "   ↳ Gateway not responding, retrying in 5s..."
  sleep 5
done
echo "   ✅ LocalStack port responding"

echo "⏳ [2b/8] Waiting for data seed to complete..."
# docker wait is the most reliable way to wait for a one-shot container
# It blocks until the container stops.
docker wait costscrunch-localstack-seed > /dev/null

# Verify success via exit code — atomic and reliable (avoids grep/emoji issues)
EXIT_CODE=$(docker inspect costscrunch-localstack-seed --format '{{.State.ExitCode}}' 2>/dev/null || echo "1")
if [ "$EXIT_CODE" != "0" ]; then
    echo "❌ Seed container failed with exit code $EXIT_CODE"
    docker logs costscrunch-localstack-seed | tail -n 20
    exit 1
fi

echo "   ✅ Data seed complete"
echo "   ↳ Settling (2s)..."
sleep 2

# LAMBDA_EXECUTOR is set in the base docker-compose, so Lambda execution is ready.
echo "🚀 [3/8] Waiting for LocalStack to be fully ready..."
until curl -sf http://localhost:4566/_localstack/health > /dev/null 2>&1; do
  sleep 2
done
sleep 5
echo "   ✅ LocalStack ready"

echo "🔨 [4/8] Building local Lambda bundles..."
cd "$PROJECT_ROOT/backend"
npm run build:local
echo "   ✅ Lambda bundles built"

echo "📦 [5/8] Copying artifacts..."
docker exec costscrunch-localstack mkdir -p /opt/bootstrap /opt/lambda-build
docker cp "$PROJECT_ROOT/infrastructure/localstack/opt2/bootstrap.sh" costscrunch-localstack:/opt/bootstrap/bootstrap.sh
docker cp "$PROJECT_ROOT/infrastructure/localstack/opt2/enable-cors.sh" costscrunch-localstack:/opt/bootstrap/enable-cors.sh
docker cp "$PROJECT_ROOT/backend/dist/lambda/." costscrunch-localstack:/opt/lambda-build
echo "   ✅ Artifacts copied"

echo "⚙️  [6/8] Running bootstrap inside container..."
if ! docker exec costscrunch-localstack bash /opt/bootstrap/bootstrap.sh; then
    echo "❌ Bootstrap failed. Check container logs."
    exit 1
fi
echo "   ✅ Bootstrap complete"

echo "🔍 [7/8] Fetching API_ID..."
MAX_RETRIES=10
API_ID=""
for i in $(seq 1 $MAX_RETRIES); do
  # Fetch newest API name match, stripping carriage returns
  API_ID=$(docker exec costscrunch-localstack /usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1 \
    apigateway get-rest-apis \
    --query "items[?name=='costscrunch-dev-api'].id | [-1]" \
    --output text 2>/dev/null | tr -d '\r\n ' || echo "")

  if [ -n "$API_ID" ] && [ "$API_ID" != "None" ] && [ "$API_ID" != "" ]; then
    break
  fi
  echo "   ↳ Attempt $i: API not ready, retrying..."
  sleep 5
done

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  echo "❌ Error: API 'costscrunch-dev-api' not found."
  exit 1
fi

export VITE_API_URL="http://localhost:4566/restapis/${API_ID}/local/_user_request_"
echo "   ✅ VITE_API_URL=$VITE_API_URL"

echo "🌐 [8/8] Starting frontend..."
cd "$PROJECT_ROOT/frontend"
VITE_API_URL="$VITE_API_URL" npm run dev
