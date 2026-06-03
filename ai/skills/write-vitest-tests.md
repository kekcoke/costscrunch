# CostsCrunch — write-vitest-tests.md
## Skill: Write Vitest Tests

> Canonical reference for all test mock patterns. Referenced by: qa-agent, backend-agent, frontend-agent.
> For test commands only (run/coverage): `ai/agents/qa-agent.md §7`

---

## 1. Rules

- Always `import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'` — never from `jest`
- Module-level mocks (`vi.mock(...)`) go at the top of the file, before any `describe` blocks
- `vi.clearAllMocks()` or `vi.resetAllMocks()` in `beforeEach` — never carry mock state between tests
- Do not use `.skip` or `.only` in committed code
- Integration tests: `afterAll` must flush all test resources from LocalStack (see §4)

---

## 2. Backend Unit Tests (aws-sdk-client-mock)

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
  vi.clearAllMocks();
  // Reset env vars if needed
  process.env.TABLE_NAME_MAIN = 'costscrunch-dev-main';
});

// --- Success path ---
it('creates an expense and returns 201', async () => {
  ddbMock.on(PutCommand).resolves({});
  const result = await handler(mockEvent({ body: JSON.stringify({ amount: 42.50 }) }));
  expect(result.statusCode).toBe(201);
});

// --- Paginated DynamoDB response ---
it('returns all items across multiple pages', async () => {
  ddbMock.on(QueryCommand)
    .resolvesOnce({ Items: Array(100).fill(mockItem), LastEvaluatedKey: { pk: 'CURSOR' } })
    .resolvesOnce({ Items: Array(50).fill(mockItem) });
  const result = await handler(mockEvent({}));
  expect(JSON.parse(result.body).items).toHaveLength(150);
});

// --- AWS error ---
it('returns 409 on ConditionalCheckFailedException', async () => {
  ddbMock.on(PutCommand).rejects(
    Object.assign(new Error('ConditionalCheckFailedException'), {
      name: 'ConditionalCheckFailedException',
    })
  );
  const result = await handler(mockEvent({}));
  expect(result.statusCode).toBe(409);
});

// --- TransactWrite atomicity ---
it('returns 500 and writes nothing when TransactWrite fails', async () => {
  ddbMock.on(TransactWriteCommand).rejects(new Error('TransactionCanceledException'));
  const result = await handler(mockEvent({}));
  expect(result.statusCode).toBe(500);
  expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1); // only 1 attempt
});

// --- Auth ---
it('returns 401 when userId is missing from auth context', async () => {
  const result = await handler(mockEvent({ requestContext: {} })); // no authorizer claims
  expect(result.statusCode).toBe(401);
});

// --- Zod validation ---
it('returns 400 when required field is missing', async () => {
  const result = await handler(mockEvent({ body: JSON.stringify({}) })); // missing amount
  expect(result.statusCode).toBe(400);
});
```

**Helper: mock event builder**

```typescript
function mockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/expenses',
    body: null,
    headers: {},
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'user-123', email: 'test@example.com' } },
      },
    } as any,
    pathParameters: null,
    queryStringParameters: null,
    ...overrides,
  } as APIGatewayProxyEvent;
}
```

---

## 3. Frontend Component Tests (RTL + Vitest)

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

// --- Module-level mocks (BEFORE describe blocks) ---

vi.mock('@src/services/api', () => ({
  api: {
    getExpenses: vi.fn().mockResolvedValue({ expenses: [], total: 0 }),
    uploadReceiptUrl: vi.fn().mockResolvedValue({
      url: 'https://s3.amazonaws.com/bucket/key',
      fields: { key: 'value' },
    }),
    getScanResult: vi.fn().mockResolvedValue({
      status: 'completed',
      merchant: 'Whole Foods',
      amount: 42.50,
      category: 'food',
      confidence: 95,
    }),
    updateGroup: vi.fn().mockResolvedValue({ id: 'group-1', name: 'Updated' }),
  },
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@aws-amplify/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: 'user-123' }),
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: { accessToken: { toString: () => 'mock-token' } } }),
}));

// --- Tests ---

describe('ScanModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls real upload URL API when scan is submitted', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ScanModal expenseId="exp-1" /></MemoryRouter>);

    const file = new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/upload/i), file);
    await user.click(screen.getByRole('button', { name: /scan/i }));

    await waitFor(() => {
      expect(vi.mocked(api.uploadReceiptUrl)).toHaveBeenCalledWith('exp-1');
    });
  });

  it('displays scan results when scan completes', async () => {
    render(<MemoryRouter><ScanModal expenseId="exp-1" /></MemoryRouter>);
    // ... trigger scan flow
    await waitFor(() => {
      expect(screen.getByText('Whole Foods')).toBeInTheDocument();
      expect(screen.getByText('$42.50')).toBeInTheDocument();
    });
  });
});
```

---

## 4. LocalStack Integration Tests

```typescript
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const raw = new DynamoDBClient({ endpoint: process.env.AWS_ENDPOINT_URL, region: 'us-east-1' });
const client = DynamoDBDocumentClient.from(raw);
const TABLE = process.env.TABLE_NAME_MAIN!;

// Seed test data before suite
beforeAll(async () => {
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: 'IntegTest-USER#test-1', sk: 'PROFILE#test-1', email: 'test@example.com' },
  }));
});

// Flush all test records after suite — REQUIRED
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

it('creates and retrieves a user profile', async () => {
  // test body
});
```

---

## 5. Coverage Thresholds

| Workspace | Functions | Lines | Branches |
|-----------|-----------|-------|----------|
| Backend | 75% | 75% | 70% |
| Frontend | 70% | 70% | 70% |

A fix is not complete if it causes coverage to drop below these thresholds. Check with:

```bash
cd backend && npm run test:coverage
cd frontend && npx vitest run --coverage
```

---

## 6. Prompt Template

```
Write Vitest tests for [ComponentName / Lambda handler] covering [cases].
Mock: [list what needs mocking — api.ts methods, recharts, aws-sdk clients].
Use vi.fn() (not jest.fn()). Place module-level vi.mock() before describe blocks.
Add to [backend/__tests__/unit/<lambda>.unit.test.ts | frontend/__tests__/components.test.tsx].
Ensure afterAll flushes any LocalStack state (for integration tests).
```
