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
🛡️ WAF v2 (OWASP rules + rate limiting)
        ↓
🔑 Cognito (JWT auth + MFA + PKCE)
        ↓
🔀 API Gateway HTTP API v2 (throttled: 10K req/s)
        ↓
⚡ ElastiCache Redis (response cache + sessions)
        ↓
⚙️ AWS Lambda (Node.js 20 + Powertools)
     ├── expenses/     CRUD + approval workflows
     ├── groups/       splits + balances + settlements
     ├── receipts/     S3 → Textract → Claude AI
     ├── analytics/    aggregations + trends
     └── notifications/ SES + Pinpoint push/SMS
        ↓
🗄️ DynamoDB (Global Tables us-east-1 / us-west-2)
📦 S3 (receipts + assets, KMS encrypted)
🔍 EventBridge (async event bus)
📡 CloudWatch + X-Ray (observability)
```

---

## Repository Structure
```
./
├── ai/
│   ├── adapters/
│   ├── references/
│   │   └── REFERENCES.md
│   ├── skills/
│   │   └── SKILLS.md
│   └── system/
├── backend/
│   ├── .DS_Store
│   ├── __tests__/
│   │   ├── .DS_Store
│   │   ├── __helpers__/
│   │   │   └── localstack-client.ts                  # localstack mock environment
│   │   ├── integration/
│   │   │   └── expenses.integration.test.ts
│   │   ├── jest.setup.integration.ts
│   │   ├── jest.setup.unit.ts
│   │   └── unit/
│   │       ├── analytics.unit.test.ts
│   │       ├── expenses.unit.test.ts
│   │       └── groups.unit.test.ts
│   ├── jest.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── lambdas/                                  # lambda handlers
│   │   │   ├── .DS_Store
│   │   │   ├── analytics/
│   │   │   │   └── index.ts
│   │   │   ├── expenses/
│   │   │   │   └── index.ts
│   │   │   ├── groups/
│   │   │   │   └── index.ts
│   │   │   ├── notifications/
│   │   │   │   └── index.ts
│   │   │   └── receipts/
│   │   │       └── index.ts
│   │   ├── server.ts        
│   │   └── shared/
│   │       └── models/
│   │           └── types.ts
│   ├── tsconfig.json
│   └── tsconfig.test.json
├── frontend/
│   ├── .DS_Store
│   ├── .gitignore
│   ├── README.md
│   ├── __tests__/
│   │   ├── .DS_Store
│   │   ├── components.test.tsx
│   │   └── setup.ts
│   ├── eslint.config.js
│   ├── index.html
│   ├── package.json
│   ├── public/
│   │   └── vite.svg
│   ├── src/
│   │   ├── .DS_Store
│   │   ├── App.css
│   │   ├── App.tsx
│   │   ├── assets/
│   │   │   └── react.svg
│   │   ├── components/
│   │   │   ├── donutChart.tsx
│   │   │   ├── expenseRow.tsx
│   │   │   ├── index.ts
│   │   │   ├── scanModal.tsx
│   │   │   ├── sideBar.tsx
│   │   │   ├── statCard.tsx
│   │   │   └── topBar.tsx
│   │   ├── constants/
│   │   ├── helpers/
│   │   │   ├── expense/
│   │   │   │   └── createExpenseFromForm.ts
│   │   │   ├── queryString.ts
│   │   │   └── utils.ts
│   │   ├── index.css
│   │   ├── index.html
│   │   ├── main.tsx                                  # Entrypoint
│   │   ├── mocks/                                    # Mock data
│   │   │   ├── expenses.ts
│   │   │   ├── groups.ts
│   │   │   └── results.ts
│   │   ├── models/                                   # Type, schema, constant definitions
│   │   │   ├── constants.ts
│   │   │   ├── expense.ts
│   │   │   ├── interfaceProps.ts
│   │   │   ├── scanForm.ts
│   │   │   └── types.ts
│   │   ├── pages/                                    # Route-level pages
│   │   │   ├── analytics.tsx
│   │   │   ├── dashboard.tsx
│   │   │   ├── expenses.tsx
│   │   │   ├── groups.tsx
│   │   │   ├── index.tsx
│   │   │   └── settings.tsx
│   │   ├── services/
│   │   │   └── api.ts                                 # Type-safe API client with Amplify auth
│   │   └── stores/                                    # Zustand state management
│   │       └── useExpenseStore.ts
│   ├── tsconfig.app.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts
└── infrastructure/
    ├── .dockerignore
    ├── docker-compose.localstack.yml                  # compose file localstack and seeding
    ├── localstack/
    │   └── dev/
    │       └── seed-setup.sh                          # seeds localstack according CostsCruncStack specs
    ├── package.json
    └── stacks/
        └── CostsCrunchStack.ts                        # cloud infra blueprint
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

---

## Receipt Scan Pipeline

```
User uploads file
      ↓
[Frontend] POST /receipts/upload-url
      ↓
[API] receipts Lambda (index.ts) generates S3 presigned POST URL
      ↓
[Frontend] POST directly to S3 (no Lambda in path = cheap + fast)
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
[sns-webhook Lambda] Triggered by SNS
      ↓
[Lambda] GetExpenseAnalysis (instant — job already done)
      ↓
[Lambda] Parses: merchant, amount, date, tax, tip, line items
      ↓
[Lambda] Claude 3 Haiku (Bedrock) → category + confidence + policy flags
             ↓ (on Bedrock failure)
         [Fallback] guessCategory() keyword matching → confidence: 85
      ↓
[DynamoDB] Updates scan record  →  status: "completed"
[DynamoDB] Back-fills expense record  →  merchant, amount, category (if_not_exists)
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
| Edge | CloudFront + WAF OWASP rules + Shield |
| Auth | Cognito JWT (RS256) + PKCE + MFA optional |
| Network | VPC private subnets + VPC Endpoints (no internet for AWS APIs) |
| Data | DynamoDB + S3 encrypted with KMS CMK |
| Secrets | Secrets Manager + 30-day auto-rotation |
| Audit | CloudTrail + GuardDuty + Security Hub |
| Code | Semgrep SAST + npm audit + Gitleaks in CI |
| IAM | Least-privilege per-Lambda roles, no wildcards |

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

# Data & Storage (DynamoDB & S3)
TABLE_NAME_MAIN=
TABLE_NAME_CONNECTIONS=
BUCKET_RECEIPTS_NAME=
BUCKET_ASSETS_NAME=

# Events & Messaging (EventBridge, SNS, SQS)
EVENT_BUS_NAME=
TEXTRACT_SNS_TOPIC_ARN=
TEXTRACT_ROLE_ARN=
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

```bash
# Prerequisites: Node 20+, AWS CLI, CDK CLI
npm install -g aws-cdk

# Install all dependencies
npm install

# Start frontend
npm run dev:frontend      # http://localhost:3000

# Run CDK diff (no deploy)
npm run diff

# Deploy to dev
npm run deploy:dev

# Seed dev database
npm run db:seed

# Run load test (requires k6)
npm run load-test
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
│                              CD Workflow                                     │
│  Trigger: CI success (workflow_run) or manual dispatch                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
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
- [ ] CSV/PDF export + scheduled reports

---

## License

MIT — use freely for commercial and personal projects.