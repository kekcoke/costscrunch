# CostsCrunch — SKILLS.md
## AI-Assisted Development Guide
> Last updated: 2026-03-07. Some features either omitted or included but not yet implemented.

---

## 1. Project Overview

**CostsCrunch** is a serverless expense-tracking platform targeting individuals, teams, and enterprises. The entire backend runs on AWS Lambda + DynamoDB (single-table design); the frontend is a Vite/React 18 SPA. All infrastructure is defined as CDK v2 TypeScript.

**Repo layout:**
costscrunch/
├── backend/
│   ├── .DS_Store
│   ├── __tests__/
│   │   ├── .DS_Store
│   │   ├── __helpers__/
│   │   │   └── localstack-client.ts                  ← Setup mock cloud environment
│   │   ├── integration/                              ← Integration tests
│   │   │   └── expenses.integration.test.ts
│   │   ├── jest.setup.integration.ts
│   │   ├── jest.setup.unit.ts
│   │   └── unit/                                     ← Unit tests
│   │       ├── analytics.unit.test.ts
│   │       ├── expenses.unit.test.ts
│   │       └── groups.unit.test.ts
│   ├── jest.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── lambdas/                                  ← lambda handlers
│   │   │   ├── .DS_Store
│   │   │   ├── analytics/                            ← Period aggregations + category trends
│   │   │   │   └── index.ts
│   │   │   ├── expenses/                             ← CRUD + approval workflow
│   │   │   │   └── index.ts
│   │   │   ├── groups/                               ← Group management + debt minimization
│   │   │   │   └── index.ts
│   │   │   ├── notifications/                        ← EventBridge-driven SES emails
│   │   │   │   └── index.ts
│   │   │   └── receipts/                             ← S3 → Textract → Claude → DynamoDB
│   │   │       └── index.ts
│   │   ├── server.ts                                 ← Backend entrypoint, setup
│   │   └── shared/                                   ← Types
│   │       └── models/
│   │           └── types.ts
│   ├── tsconfig.json
│   └── tsconfig.test.json
├── frontend/
│   ├── .DS_Store
│   ├── .gitignore
│   ├── README.md
│   ├── __tests__/                                   ← Frontend tests
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
│   │   ├── components/                              ← Frontend components
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
│   │   ├── main.tsx                                  ← Frontend entrypoint
│   │   ├── mocks/                                    ← Mock data
│   │   │   ├── expenses.ts
│   │   │   ├── groups.ts
│   │   │   └── results.ts
│   │   ├── models/                                   ← Type, schema, constant definitions
│   │   │   ├── constants.ts
│   │   │   ├── expense.ts
│   │   │   ├── interfaceProps.ts
│   │   │   ├── scanForm.ts
│   │   │   └── types.ts
│   │   ├── pages/                                    ← Route-level pages
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
    ├── docker-compose.localstack.yml                  ← compose file localstack and seeding
    ├── localstack/
    │   └── dev/
    │       └── seed-setup.sh                          ← seeds localstack according CostsCruncStack specs
    ├── package.json
    └── stacks/
        └── CostsCrunchStack.ts                        ← cloud infra blueprint
```
---

## 2. Architecture Principles (give this context to every AI session)

| Principle | Details |
|---|---|
| **Serverless-first** | No EC2/ECS. Every compute is Lambda (Node.js 20, 1 GB RAM). |
| **Single-table DynamoDB** | PK / SK plus GSI1 (status+date) and GSI2 (category+date). |
| **Cognito for identity** | All auth delegates to Cognito; the auth lambda is a thin orchestrator. |
| **CDK v2** | All infrastructure is code — no ClickOps. |
| **Vite + Vitest** | Frontend build tooling; tests mirror Jest API (vi.*). |
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
1. Uses Hono as the HTTP router instead of Middy.
2. Uses @aws-lambda-powertools/logger, tracer, and metrics.
3. Uses Hono middleware for:
    JSON body parsing
    centralized error handling
4. Uses hono/aws-lambda adapter to return APIGatewayProxyResultV2 (HTTP v2 format).
5. Maps Cognito exception names to friendly messages (auth lambda).
6. Never logs PII in production (use logger.info({ userId }) not { email }).

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
# Unit tests (fast, no Docker)
cd backend && npx jest --selectProjects unit

# Integration tests (requires LocalStack)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd ../backend && npx jest --selectProjects integration

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