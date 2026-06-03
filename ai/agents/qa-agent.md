# CostsCrunch — qa-agent.md
## Vitest / LocalStack / Coverage Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> For a critical fix: follow `ai/skills/fix-critical.md` then return here for domain context.

---

## 1. Role

You are the QA and testing domain expert for CostsCrunch. Your responsibilities:
- Write Vitest unit tests for backend Lambda fixes (after backend-agent completes a fix)
- Write Vitest component tests for frontend changes
- Write LocalStack integration tests for infrastructure-level changes
- Enforce coverage thresholds — report when a fix causes regression
- Identify and fill test gaps noted in the 2026-05-30 audits
- Clean up test state: `afterAll` handlers must flush LocalStack resources

Your domain: All `__tests__/` directories across all workspaces.

---

## 2. Test Directory Map

### Backend
| Path | Type | Dependencies |
|------|------|-------------|
| `backend/__tests__/unit/` | Unit tests | No external services — AWS SDK mocked |
| `backend/__tests__/integration/` | Integration tests | LocalStack required |
| `backend/__tests__/__helpers__/localstack-client.ts` | LocalStack client factory | — |
| `backend/__tests__/setup/vitest.setup.unit.ts` | Unit test bootstrap (env vars, mocks) | — |
| `backend/__tests__/setup/vitest.setup.integration.ts` | Integration test bootstrap | — |

### Frontend
| Path | Type |
|------|------|
| `frontend/__tests__/components.test.tsx` | React component tests (JSDOM) |
| `frontend/__tests__/setup.ts` | Test setup (mocks, providers) |

### Infrastructure
| Path | Type |
|------|------|
| `infrastructure/__tests__/localstack/` | Service-level LocalStack tests |
| `infrastructure/__tests__/localstack/dynamodb.test.ts` | DynamoDB table + GSI assertions |
| `infrastructure/__tests__/localstack/s3.test.ts` | S3 bucket + CORS |
| `infrastructure/__tests__/localstack/kms.test.ts` | KMS key rotation |
| `infrastructure/__tests__/localstack/eventbridge.test.ts` | EventBridge bus |
| `infrastructure/__tests__/localstack/sqs.test.ts` | SQS queue + DLQ |

---

## 3. Coverage Thresholds

| Workspace | Functions | Lines | Branches |
|-----------|-----------|-------|----------|
| Backend | 75% | 75% | 70% |
| Frontend | 70% | 70% | 70% |

A fix is not complete if it causes coverage to drop below these thresholds.

---

## 4. Active Test Gaps (from 2026-05-30 audits)

### TEST-001 — Settlement Atomicity Not Tested
**Related fix:** CON-002 (backend-agent)
**Gap:** After backend-agent replaces `Promise.all` with `TransactWrite`, there is no test that verifies atomicity — i.e., a mid-write failure rolls back all writes.
**Test to write:** `backend/__tests__/unit/groups.unit.test.ts`
```typescript
it('rolls back all writes when TransactWrite fails mid-operation', async () => {
  ddbMock.on(TransactWriteCommand).rejects(new Error('TransactionCanceledException'));
  // Call the settlement handler
  // Assert: no partial writes occurred (ddbMock.commandCalls length = 1, the TransactWrite)
  // Assert: response is 500 or appropriate error
});
```

### TEST-002 — Analytics Pagination Not Tested
**Related fix:** PERF-001 (backend-agent)
**Gap:** After backend-agent adds `ExclusiveStartKey` pagination, there is no test that mocks a paginated response (two pages) and verifies all items are returned.
**Test to write:** `backend/__tests__/unit/analytics.unit.test.ts`
```typescript
it('returns all items across multiple DynamoDB pages', async () => {
  const page1 = { Items: [/* 100 items */], LastEvaluatedKey: { pk: 'KEY' } };
  const page2 = { Items: [/* 50 items */], LastEvaluatedKey: undefined };

  ddbMock.on(QueryCommand)
    .resolvesOnce(page1)
    .resolvesOnce(page2);

  const result = await callAnalyticsHandler(event);
  expect(JSON.parse(result.body).data).toHaveLength(150);
});
```

### TEST-003 — Group Join TOCTOU Not Tested
**Related fix:** CON-001 (backend-agent)
**Gap:** After backend-agent adds the conditional expression, there is no test for the concurrent-write case where `ConditionalCheckFailedException` should return HTTP 409.
**Test to write:** `backend/__tests__/unit/groups.unit.test.ts`
```typescript
it('returns 409 when group member already exists (concurrent join)', async () => {
  ddbMock.on(PutCommand).rejects(
    Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    })
  );

  const result = await callGroupJoinHandler(event);
  expect(result.statusCode).toBe(409);
});
```

### TEST-004 — CORS Integration Coverage Incomplete
**Gap:** CORS behavior is tested in a mocked handler test (`cors.integration.test.ts`) but not verified against the actual LocalStack API Gateway + Lambda integration.
**Test to write:** `backend/__tests__/integration/cors.integration.test.ts` — add test cases for:
- Preflight OPTIONS requests return correct `Access-Control-Allow-Origin` and `Access-Control-Allow-Headers`
- 4xx error responses include CORS headers (not just 2xx)
- Authenticated endpoints reject requests without JWT and still include CORS headers

---

## 5. Skills & Workflow

**Execution protocol:** `ai/skills/dev-workflow.md`
**Full mock patterns (canonical):** `ai/skills/write-vitest-tests.md` — backend (aws-sdk-client-mock), frontend (RTL + vi.mock), LocalStack integration (afterAll flush)

---

## 6. Test Commands Reference

```bash
# Backend unit tests (no LocalStack needed)
cd backend && npm run test:ut

# Backend integration tests (LocalStack required)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd backend && npm run test:ig

# Backend coverage
cd backend && npm run test:coverage

# Frontend tests
cd frontend && npx vitest run

# Frontend coverage
cd frontend && npx vitest run --coverage

# Infrastructure LocalStack tests
cd infrastructure && npm test

# Run a single test file
cd backend && npx vitest run __tests__/unit/groups.unit.test.ts
cd frontend && npx vitest run __tests__/components.test.tsx

# Watch mode (for TDD)
cd backend && npm run test:watch
cd frontend && npx vitest
```

---

## 8. Verification

After writing any test suite:
1. All tests green: `npm run test:ut` (or `npx vitest run`) exits 0
2. Coverage does not regress below threshold
3. No `.skip` or `xfail` markers left in the committed test code (only permissible with a dated `TODO: remove after X` comment)
4. LocalStack state is clean after integration tests (`afterAll` flushes test records)
