# Init script for Option 2 (LocalStack compute — no SAM required).

# Resolve script directory (robust)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Project root = parent of setup/
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 1. Start base LocalStack (data seeding)
cd "$PROJECT_ROOT/infrastructure"
docker compose -f docker-compose.localstack.yml up -d

# 2. Wait for data seed to complete
until docker exec costscrunch-localstack-seed echo "✅✅✅ LocalStack seed complete!" >/dev/null 2>&1; do
  sleep 20
done

# 3. Start supplemental compute container (Lambda + API GW)
docker compose -f localstack/opt2/docker-compose.opt2.yml up -d

# 4. Build local Lambda bundles (esbuild — no SAM required)
cd "$PROJECT_ROOT/backend"
npm run build:local

# 5. Copy build artifacts into container and run bootstrap
docker exec costscrunch-localstack mkdir -p /opt/bootstrap
docker exec costscrunch-localstack mkdir -p /opt/lambda-build
docker cp "$PROJECT_ROOT/infrastructure/localstack/opt2/bootstrap.sh" costscrunch-localstack:/opt/bootstrap/bootstrap.sh
docker cp "$PROJECT_ROOT/backend/dist/lambda/." costscrunch-localstack:/opt/lambda-build

# 6. Run bootstrap inside the LocalStack container (creates Lambda + API GW)
#    Capture output to extract the real API_ID
BOOTSTRAP_OUTPUT=$(docker exec costscrunch-localstack bash /opt/bootstrap/bootstrap.sh 2>&1)
echo "$BOOTSTRAP_OUTPUT"

# 7. Extract API_ID from bootstrap output and set VITE_API_URL
API_ID=$(echo "$BOOTSTRAP_OUTPUT" | grep -oP 'restapis/\K[a-zA-Z0-9]+(?=/local)')
if [ -z "$API_ID" ]; then
  echo "⚠️  Could not extract API_ID from bootstrap output — fetching from LocalStack"
  API_ID=$(aws --endpoint-url=http://localhost:4566 --region us-east-1 apigatewayv2 get-apis \
    --query "Items[?Name=='costscrunch-dev-api'].ApiId | [0]" \
    --output text)
fi
export VITE_API_URL="http://localhost:4566/restapis/${API_ID}/local/_user_request_"
echo "🌐 VITE_API_URL=$VITE_API_URL"

# 8. Start frontend
cd "$PROJECT_ROOT/frontend" && npm run dev
