# CostsCrunch — SKILLS.md
## AI-Assisted Development Guide
> Last updated: 2026-03-07. Some features either omitted or included but not yet implemented.

---

## 1. Project Overview

**CostsCrunch** is a serverless expense-tracking platform targeting individuals, teams, and enterprises. The entire backend runs on AWS Lambda + DynamoDB (single-table design); the frontend is a Vite/React 18 SPA. All infrastructure is defined as CDK v2 TypeScript.

**Repo layout:**
```
costscrunch
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
│   │   ├── __config__/
│   │   │   └── testConfig.ts
│   │   ├── __helpers__/
│   │   │   └── localstack-client.ts                  # localstack mock environment
│   │   ├── integration/
│   │   ├── __mocks__/
│   │   │   ├── .DS_Store
│   │   │   ├── @aws-lambda-powertools/
│   │   │   │   ├── index.ts
│   │   │   │   ├── logger.ts
│   │   │   │   ├── metrics.ts
│   │   │   │   └── tracer.ts
│   │   │   └── eventBridge.ts
│   │   ├── integration/
│   │   │   ├── analytics.integration.test.ts
│   │   │   ├── expenses.integration.test.ts
│   │   │   └── receipts.integration.test.ts
│   │   ├── setup/
│   │   │   ├── setupTestEnv.ts
│   │   │   ├── vitest.setup.integration.ts
│   │   │   └── vitest.setup.unit.ts
│   │   └── unit/
│   │       ├── analytics.unit.test.ts
│   │       ├── expenses.unit.test.ts
│   │       ├── groups.unit.test.ts
│   │       ├── receipts.unit.test.ts
│   │       ├── sns-webhook.unit.test.ts
│   │       └── web-socket-notifier.unit.test.ts
│   ├── package.json
│   ├── src/
│   │   ├── .DS_Store
│   │   ├── lambdas/                                  # lambda handlers
│   │   │   ├── .DS_Store
│   │   │   ├── analytics/
│   │   │   │   ├── .DS_Store
│   │   │   │   └── index.ts
│   │   │   ├── expenses/
│   │   │   │   └── index.ts
│   │   │   ├── groups/
│   │   │   │   └── index.ts
│   │   │   ├── notifications/
│   │   │   │   └── index.ts
│   │   │   ├── receipts/
│   │   │   │   └── index.ts
│   │   │   ├── sns-webhook/
│   │   │   │   └── index.ts
│   │   │   └── web-socket-notifier/
│   │   │       └── index.ts
│   │   ├── server.ts
│   │   └── shared/
│   │       └── models/
│   │           ├── charts.ts
│   │           └── types.ts
│   ├── tsconfig.json
│   ├── tsconfig.test.json
│   └── vite.config.ts
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
    ├── .DS_Store
    ├── .dockerignore
    ├── __tests__/
    │   └── localstack/
    │       ├── dynamodb.test.ts
    │       ├── eventbridge.test.ts
    │       ├── health.test.ts
    │       ├── kms.test.ts
    │       ├── s3.test.ts
    │       ├── ses.test.ts
    │       ├── sns.test.ts
    │       ├── sqs.test.ts
    │       └── ssm.test.ts
    ├── docker-compose.localstack.yml                  # compose file localstack and seeding
    ├── localstack/
    │   └── dev/
    │       └── setup.sh                               # seeds localstack according CostsCruncStack specs
    ├── package.json
    ├── stacks/
    │   └── CostsCrunchStack.ts                         # cloud infra blueprint
    └── tsconfig.json
```
---

## 2. Architecture Principles (give this context to every AI session)

| Principle | Details |
|---|---|
| **Serverless-first** | No EC2/ECS. Every compute is Lambda (Node.js 20, 1 GB RAM). |
| **Single-table DynamoDB** | PK / SK plus GSI1 (status+date) and GSI2 (category+date). |
| **Cognito for identity** | All auth delegates to Cognito; the auth lambda is a thin orchestrator. |
| **CDK v2** | All infrastructure is code — no ClickOps. |
| **Full Vitest Stack** | Both frontend AND backend use Vitest for unified testing (vi.*). |
| **P99 < 80 ms** | Lambda provisioned concurrency on hot paths. DynamoDB on-demand. |

---

## 3. Key Conventions

### 3.1 DynamoDB key patterns
```
USER#<userId>   / PROFILE#<userId>
USER#<userId>   / EXPENSE#<expenseId>
USER#<userId>   / NOTIFICATION#<timestamp>
GROUP#<groupId> / PROFILE#<groupId>
GROUP#<groupId> / EXPENSE#<expenseId>
GROUP#<groupId> / MEMBER#<userId>

GSI1PK = STATUS#<status>    GSI1SK = DATE#<isoDate>
GSI2PK = CATEGORY#<cat>     GSI2SK = DATE#<isoDate>
```
IDs are always ULIDs (sortable, no UUID collisions). Use the `ulid` npm package.

### 3.2 Lambda handler pattern
Every Lambda:
1. Uses a standard router pattern with a `normalizeRoute` helper to bridge REST v1 (actual paths) and dev-server (route keys).
2. Uses @aws-lambda-powertools/logger, tracer, and metrics.
3. Includes a `CORS_HEADERS` constant in all response helpers (`ok`, `err`) to pass browser preflight.
4. Returns APIGatewayProxyResult (REST v1 format).
5. Implements **Data Integrity Guards**:
    - Atomic creation (e.g., Group + Member mapping in one `TransactWrite`).
    - Block-on-Balance: Prevent member/group removal if balances are not settled ($0.00).
6. Never logs PII in production.
7. **Daily Changelogs**: Every session involving feature branch changes must conclude with a new entry in `changelog/YYYY-MM-DD.md` summarizing infra, backend, frontend, and test advancements.

### 3.3 Auth flow
```
Login  →  POST /auth/login
  ├── mfaRequired: false  →  { accessToken }  (store in useAuthStore.token)
  └── mfaRequired: true   →  { mfaSessionToken }  →  POST /auth/mfa/verify  →  { accessToken }

OAuth  →  loginWithOAuth(provider)
  └── redirect Cognito Hosted UI  →  GET /auth/oauth/callback  →  Set-Cookie + redirect /#access_token=...

Token refresh  →  automatic on 401 in apiFetch()
  └── POST /auth/refresh (refresh_token httpOnly cookie sent automatically)
```

### 3.4 Statement import pipeline
```
File arrives → size check:
  < 1 MB  →  POST /statements/import (body = raw bytes)
  >= 1 MB  →  GET /statements/upload-url → PUT presigned S3 → POST /statements/import { s3Key }

Server-side:
  CSV  →  parseCSV()  →  column detection via alias sets  →  rowToExpense()
  PDF  →  S3 object  →  Textract DetectDocumentText  →  parsePDFText()  →  rowToExpense()
       (heuristic: DATE_PATTERN + AMOUNT_PATTERN on each text line)

rowToExpense()  →  inferCategory()  →  batchWriteExpenses() (DynamoDB BatchWrite, 25/chunk)
```

### 3.5 Analytics page chart types
| Type | Recharts component | X-axis | Y-axis |
|---|---|---|---|
| Donut | Custom SVG DonutChart | N/A | N/A |

Chart switching (soon) uses React.startTransition so the old chart stays visible until the new one is ready.

### 3.6 Troubleshooting & Documentation Protocol
When performing feature tests or troubleshooting patches:
1. **Command Logging**: Record the exact commands used to reproduce the failure (e.g., `cd infrastructure && npx vitest run __tests__/Specific.test.ts`).
2. **Investigation Depth**: Systematically apply targeted tools (`grep`, `find`, `ls -R`, `jq`, `env`, `Annotations.fromStack`, log tracing, and `git diff`) to surface and resolve environment-specific issues (e.g., token resolution failures, config drift, variable misalignment, dependency inconsistencies).
3. **Troubleshooting Summary**: Upon resolution, create a technical summary in `notes/YYYY-MM-DD-feature-context-tb.md`.
    - **Problem Statement**: Describe the failure and error codes.
    - **Commands Used**: List steps taken to identify and fix the issue.
    - **Root Cause**: Explain why the issue occurred (e.g., direct string manipulation on CDK Tokens).
    - **Final Solution**: Provide code snippets and verification results.
4. **Knowledge Loop**: If a new pitfall is discovered, update section 6 of this document.


---

## 4. AI Prompting Patterns

### 4.1 Adding a new Lambda endpoint
```
Context to include:
- "CostsCrunch uses DynamoDB single-table. PK=USER#<userId> SK=EXPENSE#<id>. GSI1 is STATUS#<status> / DATE#<date>, GSI2 is CATEGORY#<cat> / DATE#<date>.
- Lambdas use Hono (hono/aws-lambda) for routing and middleware with @aws-lambda-powertools (logger, tracer, metrics). Handlers return APIGatewayProxyResultV2.
- Auth is Cognito JWT; userId = c.get('jwtPayload').sub (from Hono auth middleware), or userId = event.requestContext.authorizer.jwt.claims.sub

Prompt template:
"Add a Lambda endpoint [METHOD] /[path] to the CostsCrunch backend.
 It should [description]. Follow the existing handler pattern in
 backend/lambdas/expenses/index.ts. Include zod input validation."
```

### 4.2 Adding a new frontend page/component
```
Context to include:
- "CostsCrunch uses Vite + React 18 + Zustand + React Router v6 + Recharts."
- "CSS vars: --color-bg, --color-surface, --color-surface-2, --color-border,
  --color-text, --color-text-dim, --font-display.
  Accent: #6366f1 (indigo), #0ea5e9 (sky)."
- "Auth state: useAuthStore. Expenses: useExpenseStore."
- "All API calls go through frontend/src/services/api.ts."

Prompt template:
"Create a [ComponentName] React component for CostsCrunch. It should [description].
 Use inline styles with existing CSS variables. Export from frontend/src/pages/.
 Write Vitest tests covering [scenarios]."
```

### 4.3 Adding Vitest tests
```
Context:
- "Tests are in frontend/__tests__/components.test.tsx."
- "Use vi.fn() not jest.fn(). Import from vitest not jest."
- "Recharts is mocked: vi.mock('recharts', ...) at module level."
- "react-router-dom useNavigate is mocked; mockNavigate = vi.fn()."
- "Components use data-testid attributes."

Prompt:
"Write Vitest tests for [ComponentName] covering [cases].
 Mock [list]. Add to the existing components.test.tsx."
```

---

## 5. Testing Cheatsheet

```bash
# Backend Unit tests
cd backend && npm run test:ut

# Backend Integration tests (requires LocalStack)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd ../backend && npm run test:ig

# Infrastructure LocalStack tests
cd infrastructure && npm test

# Frontend Vitest
cd frontend && npx vitest
```

---

## 6. Common Pitfalls for AI Assistants

1. **Token storage**: Access tokens go in useAuthStore.token (memory only). Never suggest localStorage.
2. **DynamoDB keys**: Always include PK, SK, and all applicable GSI keys on writes.
3. **Cognito error names**: Map exception names to user-friendly messages — never return raw Cognito errors.
4. **Statement import skips negatives**: rowToExpense() returns null for amount <= 0.
5. **Chart switching**: Use startTransition so the old chart stays visible during transition.
6. **Vitest vs Jest**: Use vi.* everywhere. Module-level mocks go at top of test file.
7. **BatchWrite limits**: DynamoDB BatchWriteItem max 25 items per call — batchWriteExpenses() already chunks.
8. **PDF parsing is heuristic**: parsePDFText() works for most bank PDFs but may miss rows in complex multi-column layouts.
9. **Infrastructure Synchronization**: When modifying S3 bucket patterns (e.g., S3 Quarantine Pattern) or environment variables in `CostsCrunchStack.ts`, apply the changes symmetrically to:
    - `infrastructure/localstack/dev/setup.sh` (resource creation)
    - `infrastructure/localstack/opt2/bootstrap.sh` (Lambda env injection)
    - `infrastructure/sam/template-*.yaml` (Local API emulation)
    - `infrastructure/.env.test` (Unit test mocks)

## 7. System Review & Risk Identification Protocol
When tasked with reviewing system behavior or investigating cross-environment inconsistencies (e.g., "Why does CORS fail locally but might pass/fail in Prod?"):

### 7.1 Analysis Framework
1. **Trace the Entry Point**: Identify where the request first hits the system (e.g., LocalStack Edge vs. CloudFront).
2. **Audit Configuration vs. Usage**: Compare defined variables (e.g., `CORS_ALLOW_HEADERS`) against where they are actually applied (e.g., `accessControlAllowHeaders`).
3. **Check Error Passthroughs**: Ensure 4xx/5xx responses from the infrastructure (API Gateway, WAF) include the same security headers as successful Lambda responses.

### 7.2 Notetaking & Reporting
Findings must be recorded in `notes/YYYY-MM-DD-context-review.md` with the following sections:
- **Environment Delta**: Highlight differences between Local, Staging, and Prod.
- **Identified Risks**: Specific configuration gaps (e.g., "CloudFront policy overrides API Gateway but lacks required headers").
- **Optimization Strategies**: Redundancy removal or streamlining (e.g., "Consolidate CORS to a single source of truth at the CDN layer").

### 7.3 Example: The "Edge-First" CORS Lesson
**Scenario**: Local API works, but Prod returns `No 'Access-Control-Allow-Origin' header`.
**Root Cause**: CloudFront `ResponseHeadersPolicy` is active but `accessControlAllowHeaders` is an empty list `[]`, blocking the `Authorization` header required by the frontend.
**Fix**: Synchronize the `CORS_ALLOW_HEADERS` array into both the API Gateway and the CloudFront policy.