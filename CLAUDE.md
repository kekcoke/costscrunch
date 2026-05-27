# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (runs all workspaces)
```bash
npm run dev          # Frontend + backend concurrently
npm run build        # Build all workspaces
npm run test         # Test all workspaces
npm run lint         # ESLint across .ts/.tsx
npm run format       # Prettier on .ts/.tsx/.json
```

### Frontend (`cd frontend`)
```bash
npm run dev          # Vite dev server (port 3000)
npm run test         # Vitest run
npm run test:watch   # Vitest watch mode
npm run test:coverage
```

### Backend (`cd backend`)
```bash
npm run dev          # Express + tsx watch (port 4000)
npm run dev:sam      # SAM CLI local start-api (port 4000)
npm run test:ut      # Unit tests only (no LocalStack needed)
npm run test:ig      # Integration tests (requires LocalStack running)
```

### Infrastructure (`cd infrastructure`)
```bash
npm run synth               # CDK synthesis
npm run deploy:dev          # Deploy dev stage
npm run deploy:staging      # Deploy staging stage
npm run deploy:prod         # Deploy prod stage
npm run test:localstack     # LocalStack-based infra tests
```

### Local dev options (root)
```bash
npm run dev:opt3    # Recommended: LocalStack (data) + SAM CLI + Vite
npm run dev:opt2    # Full LocalStack (compute + data) + Vite
```

## Architecture

CostsCrunch is a serverless expense tracker monorepo with four npm workspaces: `frontend`, `backend`, `infrastructure`, `shared`.

### Monorepo workspaces

| Workspace | Role |
|-----------|------|
| `frontend` | React 19 + Vite SPA, deployed to CloudFront + S3 |
| `backend` | 12 Lambda functions + Express adapter for local dev |
| `infrastructure` | AWS CDK v2 stacks defining all cloud resources |
| `shared` | Types and utilities shared across frontend/backend |

### Backend Lambda functions

Each function is a separate entry point bundled by esbuild at deploy time:

- **expenses** — CRUD + multi-party approval workflows
- **groups** — splits, balances, and settlement logic
- **receipts** — S3 presigned URL generation, Textract async trigger
- **image-preprocess** — Sharp-based lossless compression (JPEG/PNG/HEIC)
- **sns-webhook** — Textract completion → Bedrock Claude categorization → DynamoDB write
- **web-socket-handler** — WebSocket `$connect`/`$disconnect` lifecycle
- **web-socket-notifier** — Pushes real-time receipt scan results to connected clients
- **auth** — Registration, login, MFA, PKCE token exchange, password reset
- **auth-trigger** — Post-Cognito-confirmation DynamoDB profile creation
- **analytics** — Aggregations and trend queries by category + time
- **profile** — User account settings
- **expense-export** — CSV/JSON export with S3 fallback for large payloads
- **health** — Smoke tests used by CI/CD health checks

### API gateway dual-mode

Production uses **HTTP API v2** (flat routes); local dev (LocalStack / SAM) uses **REST API v1** (hierarchical routes). The `resolveRoute(event)` helper and `ApiEvent` discriminated union handle both transparently. Lambda handlers receive an `AuthContext` (`userId`, `email`, `groups`, `plan`) via `getAuth(event)`.

### DynamoDB single-table design

All entities share one table with a `pk`/`sk` key schema. Key patterns:

| Entity | pk | sk |
|--------|----|----|
| User profile | `USER#uid` | `PROFILE#uid` |
| Personal expense | `USER#uid` | `EXPENSE#expId` |
| Group expense | `GROUP#gid` | `EXPENSE#expId` |
| Email lookup | `EMAIL#email` | `USER#uid` |
| Receipt scan (TTL 30d) | `RECEIPT#expId` | `SCAN#scanId` |

GSIs: `gsi1` (approval queue by status+date), `gsi2` (analytics by category+date), `gsi3` (duplicate detection by receipt hash).

### Receipt pipeline

1. Client uploads image → presigned S3 URL (`receipts` Lambda)
2. S3 event → `image-preprocess` Lambda compresses via Sharp → `processed-{env}` bucket
3. `receipts` Lambda triggers Textract async analysis
4. Textract sends completion to SNS topic → SQS queue → `sns-webhook` Lambda
5. `sns-webhook` parses Textract output, calls **Bedrock Claude Haiku** for category classification (circuit breaker: 5 failures → 30s cooldown → keyword fallback), writes result to DynamoDB
6. `web-socket-notifier` Lambda pushes result to the client via WebSocket API

### Infrastructure (CDK)

Entry point: `infrastructure/bin/costscrunch.ts`. Stage is passed via CDK context (`--context stage=dev|staging|prod`). Stage-specific differences: DynamoDB capacity mode (on-demand vs provisioned), Lambda provisioned concurrency, CloudWatch alarm thresholds, and `RemovalPolicy` (destroy vs retain).

Secrets live in SSM Parameter Store and Secrets Manager — never in Lambda environment variables (enforced by a CDK `IAspect` during `cdk synth`).

### Frontend state

- **Zustand** stores per domain (expenses, groups, profile, etc.)
- **@tanstack/react-query** for server state / async fetching
- **AWS Amplify Auth** for Cognito token management
- **React Router v7** for client-side routing
- Axios with a typed wrapper that injects Cognito JWTs

## Key conventions

**TypeScript**: Strict mode everywhere. Zero ESLint warnings (`--max-warnings 0`).

**Import aliases**:
- Frontend: `@src`, `@tests`
- Backend: `@shared`, `@lambdas`, `@config`, `@helpers`, `@mocks`
- Infrastructure: `@shared`, `@lambdas`

**Lambda handler pattern** (backend):
```typescript
export const handler = withErrorHandler(async (event, context) => {
  const { userId, email, groups } = getAuth(event);
  // ...
});
```

**Logging** (backend): Use `@aws-lambda-powertools/logger`. Never use `console.log` in Lambda handlers.

**Local dev env**: `.env.dev` at the root sets `MOCK_AUTH=true` (bypasses Cognito JWT validation) and `AWS_ENDPOINT_URL=http://localhost:4566` (LocalStack).

**Tests**:
- Backend unit tests mock AWS SDK clients via `aws-sdk-client-mock`; they run without any local services.
- Backend integration tests require LocalStack — run `npm run test:ig` only when LocalStack is up.
- Frontend tests use JSDOM environment; coverage threshold is 70% branches/functions/lines.
- Backend coverage thresholds: 75% functions/lines, 70% branches.
