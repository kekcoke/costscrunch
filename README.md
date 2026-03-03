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
costscrunch/
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main React SPA (dashboard, expenses, groups, analytics)
│   │   ├── services/
│   │   │   └── api.ts           # Type-safe API client with Amplify auth
│   │   ├── components/          # Reusable UI components
│   │   ├── pages/               # Route-level pages
│   │   ├── hooks/               # Custom React hooks
│   │   └── store/               # Zustand state management
│   └── package.json
│
├── backend/
│   ├── src
│   │   ├── lambdas/
│   │   │   ├── expenses/index.ts    # CRUD + approval workflow
│   │   │   ├── groups/index.ts      # Groups + splits + debt minimization
│   │   │   ├── receipts/index.ts    # S3 → Textract → Claude AI pipeline
│   │   │   ├── analytics/index.ts   # Aggregations + trends
│   │   │   └── notifications/index.ts  # SES email + Pinpoint push
│   │   └── shared/
│   │       └── models/types.ts      # All TypeScript types + DynamoDB key patterns
│   └── package.json
│   └── tsconfig.json
│
├── infrastructure/
│   └── stacks/
│   │   └── CostsCrunchStack.ts    # Full AWS CDK v2 stack
│.  └── package.json
│
└── .github/
│   └── workflows/
│       └── deploy.yml           # CI/CD: test → SAST → staging → prod
└── package.json
└── .gitignore
└── README.md
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
[Frontend] GET /receipts/upload-url
      ↓
[API] Lambda generates S3 pre-signed PUT URL (15 min TTL)
      ↓
[Frontend] PUT directly to S3 (no Lambda in the path = cheap + fast)
      ↓
[S3 Event] Triggers receipts Lambda
      ↓
[Lambda] AWS Textract StartExpenseAnalysis → polls for completion
      ↓
[Lambda] Parses: merchant, amount, date, tax, line items
      ↓
[Lambda] Claude 3 Haiku (Bedrock) → category + confidence + policy flags
      ↓
[DynamoDB] Updates expense record + scan result
      ↓
[EventBridge] Emits ReceiptScanCompleted event
      ↓
[Notifications Lambda] Sends email/push to user
```

**Supported inputs:** JPG, PNG, HEIC, PDF  
**Average processing time:** 3–8 seconds  
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
# Backend (set via CDK / SSM)
TABLE_NAME=costscrunch-prod-main
EVENT_BUS_NAME=costscrunch-prod-events
RECEIPTS_BUCKET=costscrunch-prod-receipts-{account}
REDIS_HOST=...elasticache.amazonaws.com
REDIS_PORT=6379
USER_POOL_ID=us-east-1_xxxxxxxx
FROM_EMAIL=noreply@costscrunch.io
ENVIRONMENT=prod
LOG_LEVEL=INFO

# Frontend (Vite env)
VITE_API_URL=https://api.costscrunch.io
VITE_USER_POOL_ID=us-east-1_xxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxx
VITE_REGION=us-east-1
```

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