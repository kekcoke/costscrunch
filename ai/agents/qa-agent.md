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

## 5. Mock Conventions

### Backend (aws-sdk-client-mock)
```typescript
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  // Reset all vi.fn() mocks
  vi.clearAllMocks();
});

// Simulate success
ddbMock.on(PutCommand).resolves({});
ddbMock.on(QueryCommand).resolves({ Items: [mockItem], Count: 1 });

// Simulate AWS error
ddbMock.on(PutCommand).rejects(
  Object.assign(new Error('ConditionalCheckFailedException'), {
    name: 'ConditionalCheckFailedException',
  })
);

// Simulate paginated response
ddbMock.on(QueryCommand)
  .resolvesOnce({ Items: firstPage, LastEvaluatedKey: { pk: 'CURSOR' } })
  .resolvesOnce({ Items: secondPage });
```

### Frontend (Vitest + RTL)
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mock — NOT inside describe blocks
vi.mock('@src/services/api', () => ({
  api: {
    getExpenses: vi.fn().mockResolvedValue({ expenses: [], total: 0 }),
    uploadReceiptUrl: vi.fn().mockResolvedValue({
      url: 'https://s3.amazonaws.com/bucket/key',
      fields: { key: 'value' },
    }),
    getScanResult: vi.fn().mockResolvedValue({
      status: 'completed',
      merchant: 'Test Merchant',
      amount: 42.50,
      category: 'food',
      confidence: 95,
    }),
  },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PieChart: ({ children }: any) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
```

### LocalStack Integration Tests
```typescript
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createLocalstackClient } from '../__helpers__/localstack-client';
import { afterAll, beforeAll } from 'vitest';

const client = createLocalstackClient();
const TABLE = process.env.TABLE_NAME_MAIN!;

// Cleanup: remove all test records after the suite
afterAll(async () => {
  const items = await client.send(new ScanCommand({
    TableName: TABLE,
    FilterExpression: 'begins_with(pk, :prefix)',
    ExpressionAttributeValues: { ':prefix': 'IntegTest-' },
  }));

  await Promise.all(
    (items.Items ?? []).map(item =>
      client.send(new DeleteCommand({ TableName: TABLE, Key: { pk: item.pk, sk: item.sk } }))
    )
  );
});
```

---

## 6. Operating Procedure (Autonomous)

### Writing tests for a backend fix (post-handoff from backend-agent):
1. Read the fix that was applied
2. Identify the failure path that the fix handles
3. Write a unit test that exercises that path with a mocked AWS SDK
4. Run `cd backend && npm run test:ut` — must be green
5. Check coverage: `npm run test:coverage` — must not regress
6. Commit: `git commit -m "test: <description> (covers <audit-id>)"`

### Writing tests for a frontend fix (post-handoff from frontend-agent):
1. Read the component fix
2. Write a component test using RTL + userEvent
3. Run `cd frontend && npx vitest run` — must be green
4. Commit: `git commit -m "test: <description> (covers <audit-id>)"`

### Writing LocalStack integration tests (post-handoff from infra-agent):
1. Ensure LocalStack is running: `cd infrastructure && docker compose -f docker-compose.localstack.yml up -d`
2. Write the test using the LocalStack client helper
3. Run `cd infrastructure && npm test` — must be green
4. Commit: `git commit -m "test: <description>"`

---

## 7. Test Commands Reference

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
