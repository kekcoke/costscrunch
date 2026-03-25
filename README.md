# 💸 CostsCrunch
### Serverless Expense Tracker · Individual / Group / Business

> **MVP Boilerplate** built on the AWS serverless architecture blueprint: Lambda + DynamoDB + Cognito + S3 + API Gateway + Textract + Bedrock

---

## Architecture Overview

```
📱 React / React Native / Flutter
        ↓
🌍 CloudFront (CDN + TLS 1.3 + HTTP/3)
        ↓
🛡️ WAF v2 (OWASP + SQLi rules + global & path-specific rate limiting + access logging)
        ↓
🔑 Cognito (JWT auth + MFA + PKCE)
        ↓
🔀 API Gateway REST API v1 (Standardized for LocalStack parity)
        ↓
⚡ ElastiCache Redis (response cache + sessions)
        ↓
⚙️ AWS Lambda (Node.js 20 + Powertools + X-Ray 1% sampling + Vitest)
     ├── expenses/       CRUD + approval workflows
     ├── groups/         splits + balances + settlements
     ├── receipts/       S3 → Textract async triggering
     ├── image-preprocess/ Lossless image compression (Sharp)
     ├── sns-webhook/    Textract completion → circuit breaker → Claude AI → DB
     ├── ws-notifier/    Real-time WebSocket updates
     ├── analytics/      aggregations + trends
     ├── notifications/  SES + Pinpoint push/SMS
     └── health/         Monitoring + CI/CD smoke tests
        ↓
🗄️ DynamoDB (Global Tables us-east-1 / us-west-2)
📦 S3 (uploads + processed + receipts + assets, KMS encrypted)
🔍 EventBridge (async event bus)
📡 CloudWatch + X-Ray (observability)
```

---

## Repository Structure
```
costscrunch
├── ai/                      # Agent prompts, domain skills, and system configs
├── backend/
│   ├── __tests__/           # Unit (mocked) and Integration (LocalStack) suites
│   ├── src/
│   │   ├── lambdas/         # Service handlers (Groups, Expenses, Analytics, etc.)
│   │   ├── utils/           # Shared utilities (Structured Logger, Error Handler, etc.)
│   │   ├── _local/          # Local dev auth wrappers (mock authorizer)
│   │   ├── shared/          # Domain models and common types
│   │   └── server.ts        # Express-to-Lambda adapter for fast dev cycles
│   └── vite.config.ts
├── frontend/
│   ├── __tests__/           # Component and Store unit tests (Vitest + RTL)
│   ├── src/
│   │   ├── components/      # UI Building blocks (Modals, Rows, Charts)
│   │   ├── pages/           # Route containers and view logic
│   │   ├── services/        # Type-safe API client (Amplify-integrated)
│   │   ├── stores/          # Zustand state management
│   │   └── models/          # Frontend-specific type definitions
│   └── vite.config.ts
└── infrastructure/
    ├── __tests__/
    │   ├── unit/            # CDK assertion tests (billing, encryption)
    │   └── localstack/      # Service-level integration tests
    ├── localstack/          # Provisioning (Setup & Bootstrap) for Option 2
    ├── sam/                 # Local emulation templates (REST v1 / ARM64)
    ├── stacks/              # CDK Infrastructure-as-Code definitions
    ├── .env.dev             # Mock variables for Vitest execution
    └── docker-compose.yml   # Multi-container orchestration (LocalStack base)
```

---

## DynamoDB Single-Table Design

| pk | sk | Entity | Notes |
|---|---|---|---|
| `USER#uid` | `PROFILE#uid` | User profile | Main user record |
| `USER#uid` | `EXPENSE#expId` | Personal expense | User's own expenses |
| `USER#uid` | `GROUP_MEMBER#gid` | Group membership | Denormalized for fast lookup |
| `USER#uid` | `NOTIFICATION#ts` | Notification | TTL 90 days |
| `GROUP#gid` | `PROFILE#gid` | Group profile | Includes members array |
| `GROUP#gid` | `EXPENSE#expId` | Group expense | Expenses shared to group |
| `EMAIL#email` | `USER#uid` | Email index | Login by email lookup |
| `RECEIPT#expId` | `SCAN#scanId` | Scan result | TTL 30 days |

**GSI1:** `gsi1pk = STATUS#status`, `gsi1sk = DATE#date#expId`  
→ Query all expenses by status + date range (admin approval queue)

**GSI2:** `gsi2pk = CATEGORY#category`, `gsi2sk = DATE#date#expId`  
→ Analytics queries by category + time period

**ReceiptHashIndex (GSI3):** `gsi3pk = RECEIPT_HASH#hash`, `gsi3sk = DATE#date`
→ Duplicate receipt detection via exact hash lookup
---

## Receipt Scan Pipeline

### Image Preprocessing Layer (NEW)

All user uploads now pass through a lossless compression layer before Textract processing:

```
┌─────────────────────────────────────────────────────────────────┐
│                    IMAGE PREPROCESSING PIPELINE                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌───────────────────┐    ┌──────────────┐  │
│  │ UploadsBucket│───▶│ image-preprocess  │───▶│ProcessBucket │  │
│  │  (uploads/)  │    │     Lambda        │    │ (receipts/)  │  │
│  └──────────────┘    └───────────────────┘    └──────────────┘  │
│         │                     │                     │           │
│         │              ┌──────┴──────┐              │           │
│         │              │   SHARP     │              │           │
│         │              │ compression │              │           │
│         │              └──────┬──────┘              │           │
│         │                     │                     │           │
│    3-day TTL            JPEG: quality 100     30-day TTL        │
│    (auto-cleanup)       PNG:  level 9         (long-term)       │
│                         HEIC→JPEG convert                       │
│                         PDF: pass-through                       │
└─────────────────────────────────────────────────────────────────┘
```

**Benefits:**
- **Cost reduction:** Smaller files = lower Textract costs (charged per page)
- **Faster processing:** Reduced S3 transfer time
- **Storage optimization:** Compressed images stored long-term
- **HEIC support:** iPhone photos auto-converted to JPEG

**Compression settings:**
| Format | Settings | Typical Reduction |
|--------|----------|-------------------|
| JPEG | quality: 100, mozjpeg: true | 10-30% |
| PNG | compressionLevel: 9, adaptiveFiltering | 15-40% |
| HEIC | → JPEG (quality: 100) | N/A (format change) |
| PDF | Pass-through unchanged | 0% |

### Full Pipeline Flow

```
User uploads file
      ↓
[Frontend] POST /receipts/upload-url
      ↓
[API] receipts Lambda generates S3 presigned POST URL
      │  → Bucket: UploadsBucket
      │  → Key prefix: uploads/{userId}/{expenseId}/{scanId}/
      ↓
[Frontend] POST directly to S3 (no Lambda in path = cheap + fast)
      ↓
[S3 Event] Triggers image-preprocess Lambda
      ↓
[Lambda] Compresses image using Sharp (lossless)
      ↓
[Lambda] Uploads to ProcessedBucket with key: receipts/{userId}/{expenseId}/{scanId}/
      ↓
[S3 Event] Triggers receipts Lambda (index.ts)
      ↓
[Lambda] Writes scan record to DynamoDB  →  status: "processing"
      ↓
[Lambda] StartExpenseAnalysis (async) with SNS NotificationChannel + JobTag
      ↓
    Lambda returns immediately — no polling, no timeout risk
      ↓
         ╔══════════════════════════════════╗
         ║ Textract processes file(10–90s)  ║
         ╚══════════════════════════════════╝
      ↓
[SNS] textract-completion topic receives job completion notification
      ↓
[SQS] scan-queue (DLQ attached)
      ↓
[sns-webhook Lambda] Triggered by SQS
      ↓
[Lambda] GetExpenseAnalysis (instant — job already done)
      │  ↳ Circuit breaker: 5 failures → OPEN (30s cooldown)
      │     On OPEN → status: "pending_manual_review" (no Textract call)
      ↓
[Lambda] Parses: merchant, amount, date, tax, tip, line items
      ↓
[Lambda] Computes receipt hash (merchant + date + amount)
      ↓
[Lambda] Queries DynamoDB ReceiptHashIndex GSI
      ↓ (if match found)
[Lambda] Levenshtein fuzzy match on merchant name
      ↓ (if similarity >= 85%)
[DynamoDB] Updates existing scan status: "duplicate"
      ↓
[EventBridge] Emits DuplicateReceiptDetected
      ↓
[Lambda] Claude 3 Haiku (Bedrock) → category + confidence + policy flags
      │  ↳ Circuit breaker: 5 failures → OPEN (30s cooldown)
             ↓ (on Bedrock failure or circuit open)
         [Fallback] guessCategory() keyword matching → confidence: 85
      ↓
[DynamoDB] TransactWrite (atomic): scan → "completed" + expense back-fill (if_not_exists)
      ↓
[EventBridge] Emits ReceiptScanCompleted
      ↓
      ├──────────────────────────────────────────────┐
      ↓                                              ↓
[Notifications Lambda]                    [ws-notifier Lambda]
Sends email / push / Pinpoint             Looks up connectionId(s) in
to user                                   DynamoDB connections table
                                                     ↓
                                          [API Gateway WebSocket]
                                          POST @connections → browser
                                                     ↓
                                    ┌────────────────┴────────────────┐
                                    ↓                                 ↓
                             [WebSocket message]               [Timeout / error]
                             RECEIPT_SCAN_COMPLETED            fallbackHttpGet()
                             resolves watchScanResult()        GET /receipts/{id}/scan
                                    ↓                                 ↓
                                    └─────────────┬───────────────────┘
                                                  ↓
                                    [Frontend] UI updated with
                                    merchant, amount, category,
                                    confidence, policy flags
```

**Supported inputs:** JPG, PNG, HEIC, PDF  
**Processing time:** 10–90 seconds (Textract async job)  
**AI confidence:** typically 88–98%  
**Fallback:** keyword-based categorization if Bedrock unavailable  

### Backwards Compatibility

The preprocessing layer is designed for seamless backwards compatibility:

| Scenario | Behavior |
|----------|----------|
| **Existing frontend** | No changes required — upload URL endpoint returns new bucket/key transparently |
| **Direct ProcessedBucket upload** | Still works — receipts Lambda triggers on `receipts/` prefix in ProcessedBucket |
| **Missing BUCKET_UPLOADS_NAME** | Falls back to BUCKET_RECEIPTS_NAME for upload URLs |
| **HEIC files** | Now supported — auto-converted to JPEG during preprocessing |
| **API response shape** | Unchanged — still returns `{ url, fields, key, expenseId, scanId }` |

**Migration path for existing deployments:**
1. Deploy new UploadsBucket and ProcessedBucket (CDK handles creation)
2. Deploy image-preprocess Lambda
3. Update receipts Lambda env vars: add `BUCKET_UPLOADS_NAME`, `BUCKET_PROCESSED_NAME`
4. Update S3 event sources via CDK (automatic on deploy)
5. No frontend changes required

### Duplicate Receipt Detection

The pipeline detects potential duplicate receipts using a two-stage matching approach:

```
[New Receipt Scan]
      ↓
[Compute Hash] SHA-256(merchant + date + amount) normalized
      ↓
[DynamoDB Query] ReceiptHashIndex GSI (O(1) lookup)
      ↓
┌─────────────────────────────────────┐
│ No match found                      │ Match found (same hash)
│ → Continue normal processing        │ → Fuzzy match merchant names
└─────────────────────────────────────┘
                                              ↓
                                    [Levenshtein Distance]
                                              ↓
                                    similarity >= 85%?
                                    ┌─────────┴─────────┐
                                    Yes                 No
                                    ↓                   ↓
                          [Mark as "duplicate"]  [Continue processing]
                          [Emit DuplicateReceiptDetected event]
```

**Hash computation:**
- Inputs: normalized merchant name, date, total amount
- Normalization: lowercase, trim whitespace, remove common suffixes (Inc, LLC, etc.)
- Result: deterministic SHA-256 hash stored as `receiptHash` attribute

**Fuzzy matching:**
- Algorithm: Levenshtein distance (edit distance)
- Threshold: 85% similarity (handles "Walmart" vs "WALMART", minor typos)
- Applied when exact hash matches (same merchant/date/amount)

**Handling duplicate matches:**
- Scan status updated to `"duplicate"`
- Links to original scan via `duplicateOf` attribute
- `DuplicateReceiptDetected` EventBridge event emitted for notifications
- No expense created (avoids double-counting)

**Graceful degradation:** If the `ReceiptHashIndex` GSI is missing (older deployments), the check is skipped and processing continues normally.

---

## Group Expense Splitting

```typescript
// Split methods
"equal"      // divide equally among all members
"exact"      // specify exact amounts per person
"percentage" // specify percentages (must sum to 100)
"shares"     // weighted shares (e.g. 2:1:1 → 50%/25%/25%)

// Debt minimization algorithm (O(n) simplified)
// Converts N*(N-1)/2 possible transactions → at most N-1
// Example: A owes B $30, B owes C $30 → A pays C $30 directly
```

---

## Security Posture

| Layer | Control |
|---|---|
| Edge | CloudFront + WAF OWASP/SQLi rules + global & path rate limiting + access logging + Shield |
| Auth | Cognito JWT (RS256) + PKCE + MFA optional |
| Network | VPC private subnets + VPC Endpoints (no internet for AWS APIs) |
| Data | DynamoDB + S3 encrypted with KMS CMK (Rotation Enforced) |
| Secrets | SSM Parameter Store + Secrets Manager (no plain-text secrets in env vars or outputs) |
| Input Validation | Zod schemas at Lambda handler layer — all API bodies and query params validated |
| Audit | CloudTrail + GuardDuty + Security Hub |
| Code | Semgrep SAST + npm audit + Gitleaks in CI |
| IAM | Least-privilege per-Lambda roles, no wildcards |

### Secrets Management

Sensitive values are stored in AWS SSM Parameter Store and Secrets Manager. Lambda functions retrieve them at runtime via IAM-granted access — no secrets appear in CloudFormation templates or environment variables.

| Secret Type | Storage | Parameter Path / Secret Name |
|-------------|---------|----------------------------|
| Bedrock Model ID | SSM Parameter Store | `/costscrunch-{env}/bedrock-model-id` |
| Frontend URL (CORS) | SSM Parameter Store | `/costscrunch-{env}/vite-app-url` |
| Sender Email | SSM Parameter Store | `/costscrunch-{env}/from-email` |
| Pinpoint App ID | SSM Parameter Store | `/costscrunch-{env}/pinpoint-app-id` |
| Notification Config | Secrets Manager | `costscrunch-{env}/notification-config` |

**CDK Synthesis Guard:** An `IAspect` scans all Lambda functions during `cdk synth`. If a sensitive environment variable (API key, password, token, email address) is detected, synthesis fails with an error pointing to the offending construct. This prevents secrets from being accidentally committed to Infrastructure-as-Code.

---

## API Endpoints

```
AUTH (all endpoints require Bearer JWT)

Expenses
  GET    /expenses                    list with filters
  POST   /expenses                    create
  GET    /expenses/:id                get single
  PATCH  /expenses/:id                update / approve / reject
  DELETE /expenses/:id                delete
  GET    /expenses/export             export (csv/json, with S3 fallback)

Groups
  GET    /groups                      list my groups
  POST   /groups                      create group
  GET    /groups/:id                  get group
  PATCH  /groups/:id                  update settings
  GET    /groups/:id/balances         balances + settlement plan
  POST   /groups/:id/members          invite member
  DELETE /groups/:id/members/:userId  remove member

Receipts
  POST   /receipts/upload-url         get S3 pre-signed URL
  GET    /receipts/:expenseId/scan    poll scan result

Analytics
  GET    /analytics/summary?period=month|quarter|year
  GET    /analytics/trends
  GET    /analytics/chart-data

Monitoring
  GET    /health                      isolated health check
```

---

## Environment Variables

```bash
# Environment & Global Settings
ENVIRONMENT=
PREFIX=
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL=

# Logging & Observability (Powertools)
LOG_LEVEL=
DEBUG_EVENT=
POWERTOOLS_SERVICE_NAME=
POWERTOOLS_METRICS_NAMESPACE=
POWERTOOLS_LOGGER_LOG_EVENT=
ALARM_LAMBDA_ERROR_RATE_THRESHOLD=

# Data & Storage (DynamoDB & S3)
TABLE_NAME_MAIN=
TABLE_NAME_CONNECTIONS=
BUCKET_UPLOADS_NAME=        # NEW: User upload bucket (preprocessing input)
BUCKET_PROCESSED_NAME=      # NEW: Compressed images (preprocessing output)
BUCKET_RECEIPTS_NAME=       # DEPRECATED: Use UPLOADS/PROCESSED for new deployments
BUCKET_ASSETS_NAME=

# Events & Messaging (EventBridge, SNS, SQS)
EVENT_BUS_NAME=
TEXTRACT_SNS_TOPIC_ARN=
TEXTRACT_ROLE_ARN=
SCAN_DLQ_URL=
SCAN_QUEUE_URL=
FROM_EMAIL=

# Auth, Cache & APIs (Cognito, Redis, WebSocket)
USER_POOL_ID=
REDIS_HOST=
REDIS_PORT=
WEBSOCKET_ENDPOINT=

# IAM & Third-Party Services (Bedrock, Textract)
BEDROCK_MODEL_ID=```

---

## Local Development

### Prerequisites
```bash
Node 20+, AWS CLI, CDK CLI, Docker (for LocalStack), SAM CLI (for Option 3)
npm install -g aws-cdk aws-sam-cli
npm install
```

### Local Request-Response Flows

Understanding how data moves through local environments is critical for troubleshooting routing and CORS.

#### Option 2 Flow (Full LocalStack Compute)
Standardizes on **REST API v1** to ensure feature parity with free-tier LocalStack.
```mermaid
sequenceDiagram
    participant Browser
    participant LS_Edge as LocalStack (4566)
    participant APIGW as API Gateway (v1)
    participant Lambda as Groups Lambda

    Note over Browser, Lambda: Preflight Flow
    Browser->>LS_Edge: OPTIONS /groups/123
    LS_Edge->>APIGW: Match /groups/{id} resource
    APIGW->>APIGW: Execute MOCK Integration (CORS enforcer)
    APIGW-->>Browser: 200 OK (CORS Headers)

    Note over Browser, Lambda: Actual Request Flow
    Browser->>LS_Edge: GET /groups/123
    LS_Edge->>APIGW: Match /groups/{id} resource
    APIGW->>Lambda: Invoke via AWS_PROXY
    Lambda->>Lambda: resolveRoute() -> "GET /groups/123"
    Lambda->>Lambda: withLocalAuth() middleware
    Lambda->>Lambda: getAuth(event) -> Unified claims
    Lambda->>Lambda: response helpers inject CORS headers (Access-Control-Allow-Origin)
    Lambda-->>Browser: 200 OK + Data + CORS Headers (Required for REST v1 Proxy)
```

#### Option 3 Flow (SAM CLI + Express)
Uses a **Hono-style adapter** to bridge Express and Lambda locally.
```mermaid
sequenceDiagram
    participant Browser
    participant Express as Express (4000)
    participant Adapter as lambdaAdapter
    participant Lambda as Lambda Handler

    Browser->>Express: GET /groups/123
    Express->>Express: cors() Middleware
    Express->>Adapter: Pass req
    Adapter->>Adapter: Map req -> Event (V2 Format)
    Adapter->>Adapter: Inject Auth Claims
    Adapter->>Lambda: Direct Function Call
    Lambda-->>Express: Return Result
    Express-->>Browser: JSON Response
```

### Key Differences from Production

| Feature | Local (Opt 2/3) | Production (AWS) |
| :--- | :--- | :--- |
| **API Version** | **REST API v1** (Hierarchical). | **HTTP API v2** (Flat/Global). |
| **CORS Enforce** | **Centralized (Phase 0)**: Handled by Express middleware + `lambdaAdapter` header stripping. | **Single-Layer**: Handled by CloudFront `ResponseHeadersPolicy` + API Gateway `corsPreflight`. |
| **Authorizer** | **Synthetic**: `MOCK_AUTH` wrapper in Lambda or Adapter. | **Managed**: Real Cognito JWT validation, MFA, and Token revocation. |
| **Routing** | **Manual Bridge**: Requires `normalizeRoute()` to map path segments to templates. | **Native**: AWS handles parameter mapping from URL patterns automatically. |
| **IAM/WAF** | **CRUD-Only**: Policies exist but are not enforced in LocalStack Free. | **Active**: Strict enforcement of Least Privilege and OWASP Rate Limiting. |
| **Test Env** | **JSDOM**: Browser emulation for React component and DOM testing. | **Node**: Lambda integration testing via LocalStack. |
| **Persistence** | **Ephemeral**: State is lost on container restart unless using volume mounts. | **Durable**: Point-in-Time Recovery and Multi-Region Replication active. |

---

### Three Local Stack Options

The original LocalStack setup only provisioned the **data layer** (DynamoDB, S3, SSM, etc.) — no Lambda functions or API Gateway. This caused 404s when the frontend called API endpoints. Three options now exist, each solving this differently:

| | Option 1 | Option 2 | Option 3 |
|---|---|---|---|
| **Compute layer** | ❌ None | ✅ Lambda + API GW inside LocalStack | ✅ SAM CLI local invoke |
| **Data layer** | ✅ LocalStack (setup.sh) | ✅ LocalStack (setup.sh) | ✅ LocalStack (setup.sh) |
| **Auth bypass** | N/A | `MOCK_AUTH=true` env var | `MOCK_AUTH=true` + `_local/` wrappers |
| **Complexity** | Low | Medium | Medium |
| **Use when** | Testing infra services only | Full local API with LocalStack | Full local API without Docker compute |

---

#### Option 1 — Data Layer Only (Original)

Good for testing DynamoDB, S3, SSM, etc. No API endpoints available.

```bash
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
# setup.sh seeds data automatically on container start
# Frontend will 404 on API calls — this is expected
```

#### Option 2 — Full LocalStack (Lambda + API GW Inside Container)

Provisions IAM role, 7 Lambda functions, REST API (v1) with 18-resource hierarchical tree, and automated CORS enforcement. `setup.sh` seeds data; `bootstrap.sh` provisions compute (idempotent — reuses existing API).

```bash
# One command handles everything:
npm run dev:opt2

# What it does internally:
# 1. Starts LocalStack + seed container (docker compose up)
# 2. Waits for data seed to complete
# 3. Builds Lambda bundles (npm run build:local)
# 4. Copies bootstrap.sh + enable-cors.sh + build artifacts into container
# 5. Runs bootstrap.sh (creates/reuses API, registers all routes, deploys stage)
# 6. Fetches API_ID and sets VITE_API_URL as shell env
# 7. Starts Vite dev server with correct API URL
```

**Manual re-bootstrap after `docker compose down`:**
```bash
cd backend && npm run build:local
docker exec costscrunch-localstack mkdir -p /opt/bootstrap /opt/lambda-build
docker cp infrastructure/localstack/opt2/bootstrap.sh costscrunch-localstack:/opt/bootstrap/
docker cp infrastructure/localstack/opt2/enable-cors.sh costscrunch-localstack:/opt/bootstrap/
docker cp backend/dist/lambda/. costscrunch-localstack:/opt/lambda-build/
docker exec costscrunch-localstack bash /opt/bootstrap/bootstrap.sh
# Update .env.dev with the API_ID from output, then restart Vite
```

> **Note:** `docker compose down` destroys LocalStack state (no persistent volume by default). The API ID changes on every fresh start. To persist the ID, add a named volume `localstack-data:/var/lib/localstack` to `docker-compose.localstack.yml` — see `notes/2026-03-21-fix-localstack-404s.md`.

#### Option 3 — SAM CLI Local (Recommended for Development)

Uses `sam local start-api` to run Lambda functions locally, proxying data calls to LocalStack. Requires SAM CLI but no Docker compute setup.

```bash
# 1. Start LocalStack for data layer only
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d

# 2. Build SAM template
cd ../infrastructure/sam
sam build

# 3. Start local API (Lambda functions run locally, data goes to LocalStack)
sam local start-api \
  --env-vars env.json \
  --parameter-overrides 'ParameterKey=AppUrl,ParameterValue=http://localhost:3000'

# 4. In another terminal — set frontend to SAM's local endpoint
cd ../../frontend
export VITE_API_URL="http://localhost:3001"   # SAM default port
npm run dev
```

**Key difference:** Option 3's `_local/` handler wrappers import the real handlers and wrap them with `withMockAuth()` middleware, which injects fake Cognito claims when `MOCK_AUTH=true`. This means the same handler code runs locally and in production — only the auth context differs.

---

### Running Tests

```bash
# Infrastructure tests
cd infrastructure
npm test                                        # all infra tests (loads .env.dev via setup.ts)
npx vitest run __tests__/EncryptionAspect.test.ts # Security compliance tests
npx vitest run __tests__/opt3                   # Option 3 unit tests only (no LocalStack needed)
npx vitest run __tests__/opt2                   # Option 2 integration tests (requires LocalStack + bootstrap)
npx vitest run __tests__/localstack             # Service-level LocalStack tests

# Backend tests
cd backend
npm run test:ut                                 # unit tests
npm run test:ig                                 # integration tests (requires LocalStack)
npx vitest run __tests__/integration/cors.integration.test.ts # CORS verification (mocked handlers)

# Frontend tests
cd frontend && npx vitest
```

### Deploy to AWS

```bash
npm run deploy:dev
```

---

## Scaling Notes

| Component | 10K CCU handling |
|---|---|
| Lambda | Reserved concurrency 500/fn, provisioned 50 for critical paths |
| DynamoDB | On-demand — scales to millions of requests/sec automatically |
| API Gateway | 10,000 req/s burst limit (increase via AWS Support) |
| Redis | r7g.large cluster, TTL-based eviction, ~85% cache hit rate |
| S3 + Textract | No concurrency limits — scales independently |
| Cognito | Handles millions of JWT validations at edge |

**Cost estimate at 100K MAU:** ~$450/month  
**Cost estimate at 1M MAU:** ~$4,355/month ($0.004/user/month)

---

## CI/CD Deployment

### Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CI Workflow                                    │
│  Trigger: push/PR to main, staging                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐             │
│  │   Quality    │   │   Security   │   │        Build         │             │
│  │    Gate      │   │    Scan      │   │                      │             │
│  ├──────────────┤   ├──────────────┤   ├──────────────────────┤             │
│  │ • Frontend   │   │ • Semgrep    │   │ • Backend bundle     │             │
│  │ • Backend    │   │ • npm audit  │   │ • Frontend build     │             │
│  │ • Infra      │   │ • Gitleaks   │   │ • CDK synth          │             │
│  └──────────────┘   └──────────────┘   └──────────────────────┘             │
│                              │                                              │
│                              ▼                                              │
│                    ┌──────────────────┐                                     │
│                    │    Artifacts     │                                     │
│                    │  (7-day retain)  │                                     │
│                    └──────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CD Workflow                                    │
│  Trigger: CI success (workflow_run) or manual dispatch                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐             │
│  │    Staging     │───▶│    E2E Tests   │───▶│   Production   │             │
│  │                │    │   (Playwright) │    │   (protected)  │             │
│  ├────────────────┤    └────────────────┘    ├────────────────┤             │
│  │ • CDK deploy   │           │              │ • CDK deploy   │             │
│  │ • S3 sync      │           │              │ • S3 sync      │             │
│  │ • Smoke test   │           │              │ • CF invalidate│             │
│  └────────────────┘           │              │ • Smoke test   │             │
│                               │              │ • Slack notify │             │
│                               ▼              └────────────────┘             │
│                      ┌────────────────┐                                     │
│                      │   Rollback     │  (manual trigger only)              │
│                      │  (on failure)  │                                     │
│                      └────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Required GitHub Secrets

| Secret | Description | Environment |
|--------|-------------|-------------|
| `AWS_ACCESS_KEY_ID_DEV` | AWS access key for CDK synth | CI |
| `AWS_SECRET_ACCESS_KEY_DEV` | AWS secret key for CDK synth | CI |
| `AWS_ACCESS_KEY_ID_STAGING` | AWS access key for staging deploy | CD |
| `AWS_SECRET_ACCESS_KEY_STAGING` | AWS secret key for staging deploy | CD |
| `AWS_ACCOUNT_ID_STAGING` | AWS account ID for staging | CD |
| `AWS_ACCESS_KEY_ID_PROD` | AWS access key for production | CD |
| `AWS_SECRET_ACCESS_KEY_PROD` | AWS secret key for production | CD |
| `AWS_ACCOUNT_ID_PROD` | AWS account ID for production | CD |
| `CODECOV_TOKEN` | Codecov coverage upload token | CI |
| `SEMGREP_APP_TOKEN` | Semgrep SAST token | CI |
| `VITE_API_URL` | Frontend API URL | CI |
| `VITE_APP_URL` | Frontend URL | CI |
| `VITE_USER_POOL_ID` | Cognito User Pool ID | CI |
| `VITE_USER_POOL_CLIENT_ID` | Cognito Client ID | CI |
| `STAGING_URL` | Staging base URL for E2E | CD |
| `STAGING_ASSETS_BUCKET` | S3 bucket for staging frontend | CD |
| `STAGING_CF_DISTRIBUTION_ID` | CloudFront distribution ID | CD |
| `PROD_ASSETS_BUCKET` | S3 bucket for production frontend | CD |
| `CF_DISTRIBUTION_ID` | Production CloudFront ID | CD |
| `TEST_USER_EMAIL` | Test user for E2E tests | CD |
| `TEST_USER_PASSWORD` | Test user password | CD |
| `SLACK_WEBHOOK_URL` | Slack notifications (optional) | CD |


### One-Time Setup

```bash
# 1. Bootstrap CDK in each environment (run once per account/region)
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1

# 2. Create IAM user for CI/CD with minimal permissions
# Recommended: Use OIDC federation instead of access keys
# See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments

# 3. Configure GitHub repository secrets
# Go to: Settings → Secrets and variables → Actions → New repository secret

# 4. Enable GitHub Environments
# Go to: Settings → Environments → New environment
#   - staging: No approval required
#   - production: Add required reviewers
```

### Manual Deploy

```bash
# Via GitHub Actions UI
# Navigate to Actions → CD → Run workflow
# Select environment: staging | production

# Via CLI (for development)
npm run deploy:dev      # Deploy to dev environment
npm run deploy:staging  # Deploy to staging
npm run deploy:prod     # Deploy to production (requires approval)
```

### Rollback Procedure

```bash
# Automatic rollback via CloudFormation
aws cloudformation rollback-stack --stack-name costscrunch-prod-CostsCrunchStack

# Manual redeploy previous commit
git checkout HEAD~1
npm run deploy:prod

# Via GitHub Actions
# Actions → CD → Run workflow → Select "Rollback" option
```

### Environment Protection Rules

| Environment | Approval | Deployment Branch | Auto-Deploy |
|-------------|----------|-------------------|-------------|
| staging | None | main, staging | Yes (on CI success) |
| production | 1+ reviewers | main only | Yes (after staging) |

---

## Roadmap (Post-MVP)

- [ ] Plaid integration (automatic bank transaction sync)
- [ ] OCR for physical mileage logs
- [ ] QuickBooks / Xero export
- [ ] Multi-currency with live FX rates (via Exchange Rate API)
- [ ] Business policy engine (per-category spend limits)
- [ ] Mobile apps (React Native + Expo)
- [ ] Recurring expense detection (ML)
- [ ] Slack bot for expense submission
- [x] CSV/JSON export with S3 fallback for large datasets
- [ ] PDF export + scheduled reports

---

## License

MIT — use freely for commercial and personal projects.