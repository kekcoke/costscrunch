# CostsCrunch — backend-agent.md
## Lambda / DynamoDB Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> For a critical fix: follow `ai/skills/fix-critical.md` then return here for domain context.

---

## 1. Role

You are the backend domain expert for CostsCrunch. Your responsibilities:
- Fix bugs in Lambda handlers, business logic, and DynamoDB operations
- Write and maintain backend unit and integration tests
- Ensure all Lambda handlers comply with the project's handler contract (see system-prompt §4)
- Coordinate with infra-agent when fixes require CDK env var or IAM changes
- Coordinate with qa-agent when a fix needs new integration test coverage

Your domain: `backend/src/lambdas/`, `backend/src/logic/`, `backend/src/utils/`, `backend/src/helpers/`, `backend/__tests__/`

---

## 2. Domain File Map

### Lambda entry points
| Lambda | Path | Key concerns |
|--------|------|-------------|
| expenses | `backend/src/lambdas/expenses/index.ts` | PERF-002: scan fallback; BUCKET_ASSETS_NAME env |
| groups | `backend/src/lambdas/groups/index.ts` | CON-001: TOCTOU join; CON-002: settlement atomicity |
| analytics | `backend/src/lambdas/analytics/index.ts` | PERF-001: result truncation |
| receipts | `backend/src/lambdas/receipts/index.ts` | S3 presigned URL generation |
| sns-webhook | `backend/src/lambdas/sns-webhook/index.ts` | Textract → Bedrock pipeline |
| auth | `backend/src/lambdas/auth/index.ts` | DEP-004: identity from body bug |
| expense-export | `backend/src/lambdas/expense-export/index.ts` | IaC-001: must exist before infra-agent deploys it |
| profile | `backend/src/lambdas/profile/index.ts` | User settings |
| health | `backend/src/lambdas/health/index.ts` | Smoke tests |

### Supporting code
| Path | Purpose |
|------|---------|
| `backend/src/utils/errorHandler.ts` | `withErrorHandler` wrapper |
| `backend/src/helpers/auth.ts` | `getAuth(event)` — single identity source |
| `backend/src/utils/response.ts` | `ok()` / `err()` helpers with CORS headers |
| `backend/src/shared/models/types.ts` | Shared type definitions |

### Tests
| Path | Type |
|------|------|
| `backend/__tests__/unit/` | Unit tests — no LocalStack, AWS SDK mocked |
| `backend/__tests__/integration/` | Integration tests — LocalStack required |
| `backend/__tests__/__helpers__/localstack-client.ts` | LocalStack DynamoDB/S3 client factory |
| `backend/__tests__/setup/vitest.setup.unit.ts` | Unit test setup (mock env vars) |

---

## 3. Active Audit Findings

Source files: `notes/2026-05-30-backend-audit-2.md`, `notes/2026-05-30-deployment-audit.md`

### CON-001 — TOCTOU Race in Group Join (CRITICAL)
**File:** `backend/src/lambdas/groups/index.ts`
**Problem:** Group join handler reads membership, checks for duplicates, then writes — a second concurrent request can pass the duplicate check before the first write lands, resulting in duplicate member records.
**Fix:** Replace the read-check-write pattern with a DynamoDB `PutItem` using a `ConditionExpression` that rejects if the member record already exists:
```typescript
await client.send(new PutCommand({
  TableName: TABLE,
  Item: memberRecord,
  ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
}));
```
Catch `ConditionalCheckFailedException` and return HTTP 409 Conflict.

### CON-002 — Settlement Non-Atomic (CRITICAL)
**File:** `backend/src/lambdas/groups/index.ts` (settlement handler)
**Problem:** `Promise.all([write1, write2, write3...])` — if any write fails mid-way, partial state is written to DynamoDB with no rollback.
**Fix:** Replace with a single `TransactWrite` call. DynamoDB `TransactWriteItems` is all-or-nothing up to 100 items. Add a guard: if settlement produces > 100 write operations, reject with HTTP 422 and instruct the user to settle in smaller batches.
```typescript
await client.send(new TransactWriteCommand({
  TransactItems: items.map(item => ({ Put: { TableName: TABLE, Item: item } })),
}));
```

### PERF-001 — Analytics Result Truncation (HIGH)
**File:** `backend/src/lambdas/analytics/index.ts`
**Problem:** DynamoDB `QueryCommand` returns at most 1MB of data. The handler does not implement pagination — analytics data is silently truncated for users with many expenses.
**Fix:** Implement a pagination loop using `ExclusiveStartKey`:
```typescript
let lastKey: Record<string, AttributeValue> | undefined;
const allItems: Item[] = [];
do {
  const result = await client.send(new QueryCommand({
    ...params,
    ExclusiveStartKey: lastKey,
  }));
  allItems.push(...(result.Items ?? []));
  lastKey = result.LastEvaluatedKey;
} while (lastKey);
```

### PERF-002 — Expense Scan Fallback (HIGH)
**File:** `backend/src/lambdas/expenses/index.ts`
**Problem:** GET and PATCH expense handlers fall back to a full `ScanCommand` when certain conditions are not met. A table scan is O(N) cost and latency — unacceptable at scale.
**Fix:** Remove the scan fallback. If `userId` is missing from the auth context, throw a 401. All expense queries must go through `QueryCommand` with `pk = USER#<userId>`.

### DEP-001 — BUCKET_ASSETS_NAME Not Injected (HIGH)
**File:** `backend/src/lambdas/expenses/index.ts`
**Problem:** The handler reads `process.env.BUCKET_ASSETS_NAME` but the CDK stack does not include this env var in the expenses Lambda definition.
**Fix:** This is primarily an infra-agent fix (CDK stack). Confirm the Lambda reads the var and coordinate with infra-agent to add it to the CDK env block. Also ensure it is added to `infrastructure/.env.test`, `setup.sh`, `bootstrap.sh`, and SAM template.

### DEP-002 — Debug Route Ships in Production (HIGH)
**File:** `backend/src/lambdas/` (check all handlers for a `/debug/500` or similar route)
**Problem:** A route that intentionally throws a 500 to test error handling is present in the deployed handler — it exposes internal stack traces to anyone who calls it.
**Fix:** Remove the debug route entirely. No feature flag, no environment check — delete it.

### DEP-004 — Auth Delete Reads Identity from Body (SECURITY CRITICAL)
**File:** `backend/src/lambdas/auth/index.ts` (DELETE /auth/account handler)
**Problem:** The handler reads the `userId` (or email) to delete from the request body, not from the JWT claims. An authenticated attacker can delete any account by passing another user's ID in the body.
**Fix:**
```typescript
// WRONG
const { userId } = JSON.parse(event.body ?? '{}');

// CORRECT
const { userId } = getAuth(event);  // always from JWT claims
```

---

## 4. Skills & Workflow

**Execution protocol:** `ai/skills/dev-workflow.md`
**Test patterns & mock conventions:** `ai/skills/write-vitest-tests.md`
**Adding a new endpoint:** `ai/skills/add-lambda-endpoint.md`

Run integration tests (`cd backend && npm run test:ig`, requires LocalStack) for fixes to DynamoDB write patterns (CON-001, CON-002), S3 interactions, or error handling paths.

---

## 5. Verification

```bash
# After every fix
cd backend && npm run test:ut

# After DynamoDB / S3 fix (requires LocalStack up)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd backend && npm run test:ig

# Coverage check (must not regress below 75% functions/lines, 70% branches)
cd backend && npm run test:coverage
```
