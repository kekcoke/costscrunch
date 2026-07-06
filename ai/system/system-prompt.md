# CostsCrunch — System Prompt
## Shared Context for All Agent Sessions
> Inject this file at the start of every agent session. It defines project identity, key conventions, and the autonomy gate every agent must respect.

---

## 1. Project Identity

CostsCrunch is a **serverless expense tracking platform** built as an AWS-native monorepo. It targets individuals, teams, and enterprises. All business logic runs on AWS Lambda (Node.js 20); persistence is a single DynamoDB table; all infrastructure is CDK v2 TypeScript. The frontend is a React 19 SPA deployed to CloudFront + S3.

**Four npm workspaces:**

| Workspace | Role |
|-----------|------|
| `frontend/` | React 19 + Vite SPA |
| `backend/` | 12 Lambda functions + Express adapter for local dev |
| `infrastructure/` | CDK v2 stacks — all cloud resources as code |
| `shared/` | Types and utilities shared across frontend/backend |

**Current objective:** reach production MVP. Five audit files from 2026-05-30 identified ~25 critical bugs. All agents work from those findings.

---

## 2. Stack Versions (pinned)

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 20 LTS |
| Frontend framework | React | 19.2 |
| Frontend build | Vite | 7.3 |
| State management | Zustand | 5.0 |
| Server state | @tanstack/react-query | 5.90 |
| Auth client | @aws-amplify/auth | 6.19 |
| Router | React Router | 7.13 |
| Test runner | Vitest | 4.0 |
| Backend SDK | @aws-sdk (all clients) | 3.635 |
| Observability | @aws-lambda-powertools | 2.7 |
| Schema validation | zod | 3.23 |
| IDs | ulid | 2.3 |
| IaC | aws-cdk-lib | v2 |

---

## 3. DynamoDB Single-Table Design

**Table:** `TABLE_NAME_MAIN` env var.

| pk | sk | Entity |
|----|----|--------|
| `USER#<uid>` | `PROFILE#<uid>` | User profile |
| `USER#<uid>` | `EXPENSE#<expId>` | Personal expense |
| `USER#<uid>` | `GROUP_MEMBER#<gid>` | Group membership (denormalized) |
| `USER#<uid>` | `NOTIFICATION#<ts>` | Notification (TTL 90d) |
| `GROUP#<gid>` | `PROFILE#<gid>` | Group profile + members array |
| `GROUP#<gid>` | `EXPENSE#<expId>` | Group expense |
| `EMAIL#<email>` | `USER#<uid>` | Email → userId index |
| `RECEIPT#<expId>` | `SCAN#<scanId>` | Receipt scan result (TTL 30d) |

**GSIs:**
- **GSI1:** `gsi1pk = STATUS#<status>` / `gsi1sk = DATE#<date>#<expId>` → approval queue
- **GSI2:** `gsi2pk = CATEGORY#<cat>` / `gsi2sk = DATE#<date>#<expId>` → analytics
- **GSI3:** `gsi3pk = RECEIPT_HASH#<hash>` / `gsi3sk = DATE#<date>` → duplicate detection

**Key rules:**
- All IDs are ULIDs — use the `ulid` package, never UUID or Math.random
- Always write PK, SK, and all applicable GSI keys on every `PutItem`
- `TransactWrite` for multi-item atomic operations; `BatchWrite` for bulk (max 25/call)

---

## 4. Lambda Handler Contract

Every Lambda must follow this pattern exactly:

```typescript
import { logger } from '@aws-lambda-powertools/logger';
import { withErrorHandler } from '@src/utils/errorHandler';
import { getAuth } from '@src/helpers/auth';

export const handler = withErrorHandler(async (event, context) => {
  const { userId, email } = getAuth(event);  // throws 401 if invalid
  // business logic here
  return ok({ data });  // or err(status, message)
});
```

**Non-negotiable rules:**
- Never use `console.log` — use `logger.info()`, `logger.warn()`, `logger.error()`
- Never log PII (email, name, amounts) in production
- All API bodies and query params validated with Zod at handler entry
- `getAuth(event)` is the single source of identity — never read userId from request body
- Responses use `ok()` / `err()` helpers which include CORS headers

**Local dev:** `MOCK_AUTH=true` (`.env.shared`) bypasses Cognito JWT validation. The `_local/` handler wrappers inject mock claims via `withMockAuth()`.

---

## 5. Autonomy Rules (CRITICAL — all agents must comply)

### What agents MAY do without human approval:
- Read any file in the repository
- Edit source files (`backend/`, `frontend/`, `infrastructure/`, `ai/`)
- Run any test command (`npm run test:ut`, `npx vitest run`, `npm run synth`)
- Run `git add` and `git commit` to a feature branch
- Create new feature branches with `git checkout -b`

### What agents MUST NOT do without explicit human approval:
- `git push` to any remote
- Open, merge, or comment on pull requests
- Run `npm run deploy:*` or `cdk deploy`
- Modify `.env*` files or SSM parameters
- Delete branches, tags, or any git history

### Branch naming convention:
```
fix/<domain>/<audit-id>
feat/<domain>/<short-description>
test/<domain>/<what-is-covered>
```
Examples: `fix/backend/CON-001`, `fix/infra/IaC-003`, `feat/frontend/ws-reconnect`

### Commit format (conventional commits):
```
fix: resolve TOCTOU race in group join handler (resolves CON-001)
feat: add expense-export Lambda to CDK stack (resolves IaC-001)
test: add settlement atomicity test coverage (covers CON-002)
infra: add Redis security group inbound rule (resolves IaC-003)
chore: pin all GitHub Actions to commit SHAs (resolves SEC-001)
```

### Test gate before commit:
- Run domain tests before every commit
- Do NOT commit if any test is red
- Do NOT suppress test failures with `.skip` or `// @ts-ignore` as a workaround

---

## 6. File Synchronization Rule (Infrastructure)

Any change to Lambda environment variables, S3 bucket names, or Lambda config in `CostsCrunchStack.ts` **must be mirrored** in all four locations:

| File | Purpose |
|------|---------|
| `infrastructure/localstack/dev/setup.sh` | LocalStack resource creation |
| `infrastructure/localstack/opt2/bootstrap.sh` | Lambda env injection for opt2 |
| `infrastructure/sam/template-*.yaml` | SAM local emulation templates |
| `infrastructure/.env.test` | Unit test mock env vars |

Failure to sync causes LocalStack/SAM divergence from production — a known class of bugs.

---

## 7. Notes & Changelog Conventions

- **Troubleshooting:** Create `notes/YYYY-MM-DD-<context>-tb.md` with: Problem Statement, Commands Used, Root Cause, Final Solution
- **System reviews:** Create `notes/YYYY-MM-DD-<context>-review.md` with: Environment Delta, Identified Risks, Optimization Strategies
- **Feature sessions:** End with an entry in `changelog/YYYY-MM-DD.md` covering: infra changes, backend changes, frontend changes, test additions
- **New pitfalls discovered:** Add to `ai/skills/SKILLS.md` Section 6

---

## 8. Local Development Quick Reference

```bash
# Start full local stack (recommended)
npm run dev:opt3      # LocalStack (data) + SAM CLI (compute) + Vite

# Backend tests
cd backend && npm run test:ut   # unit (no LocalStack)
cd backend && npm run test:ig   # integration (LocalStack required)

# Frontend tests
cd frontend && npx vitest run

# Infrastructure
cd infrastructure && npm run synth    # CDK synthesis (validates everything)
cd infrastructure && npm test          # LocalStack infra tests

# LocalStack
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
```

**LocalStack endpoint:** `http://localhost:4566`
**SAM local API:** `http://localhost:4000`
**Vite frontend:** `http://localhost:3000`
