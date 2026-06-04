# Test Coverage Primers — All Phases
> Copy-paste the relevant section when opening a test worktree session.
> All test worktrees require `test/e2e-setup` to be merged before E2E specs can run.

---

## frontend-agent · `feat/test/e2e-setup` (PREREQUISITE — open first)

```
You are the frontend-agent for this worktree (feat/test/e2e-setup).
This is a prerequisite worktree — all E2E test worktrees depend on this merging first.
No fix phase dependency: open immediately.

Start by reading these files:
1. .agent.md — your full domain context
2. frontend/package.json — confirm @playwright/test is not already installed
3. frontend/vite.config.ts — confirm baseURL port (3000) and proxy config
4. backend/src/lambdas/_local/mockAuth.ts — understand MOCK_AUTH=true auth injection
5. frontend/src/services/api.ts lines 1–40 — understand API base URL and auth flow
6. backend/__tests__/__helpers__/localstack-client.ts — pattern to reuse in e2e/helpers/localstack.ts

Skill available in this session: /commit-fix <ISSUE-ID>
Use label "e2e-setup" as the ISSUE-ID for each commit in this worktree.

Your tasks, in order:

TASK 1 — Install Playwright and create e2e/ workspace
  In root package.json: add "e2e" to workspaces array (if monorepo workspaces are used).
  Create e2e/package.json:
    { "name": "@costscrunch/e2e", "private": true, "devDependencies": { "@playwright/test": "^1.44.0" } }
  Run: npm install (from root) to install @playwright/test.
  Add to root package.json scripts: "test:e2e": "playwright test --config e2e/playwright.config.ts"
  Add to root package.json scripts: "test:e2e:ui": "playwright test --config e2e/playwright.config.ts --ui"
  Commit: /commit-fix e2e-setup-install

TASK 2 — Create playwright.config.ts
  File: e2e/playwright.config.ts
  Key settings:
  - testDir: './specs'
  - testMatch: '**/*.spec.ts'
  - use.baseURL: 'http://localhost:3000'
  - use.trace: 'on-first-retry'
  - use.screenshot: 'only-on-failure'
  - webServer.command: 'npm run dev:opt3'
  - webServer.url: 'http://localhost:3000'
  - webServer.reuseExistingServer: !process.env.CI
  - webServer.timeout: 120_000
  - projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
  - retries: process.env.CI ? 2 : 0
  - reporter: [['html', { open: 'never' }], ['list']]
  Commit: /commit-fix e2e-setup-config

TASK 3 — Create auth helper
  File: e2e/helpers/auth.ts
  Export: loginAsMockUser(page: Page): Promise<void>
  Strategy: navigate to '/', set localStorage items cc_access_token and cc_id_token
  to non-empty strings, then reload. This prevents /login redirects.
  MOCK_AUTH=true on the backend means no token validation occurs.
  Also export: TEST_USER_ID = '00000000-0000-0000-0000-test-user-001' (matches mockAuth.ts)
  Commit: /commit-fix e2e-setup-auth

TASK 4 — Create API and LocalStack helpers
  File: e2e/helpers/api.ts
  Export: a typed apiClient(baseUrl: string) that wraps axios or fetch for seeding test data
  via the backend Express adapter at http://localhost:4000 with MOCK_AUTH headers.
  Include: createExpense(data), deleteExpense(id), createGroup(data), deleteGroup(id)

  File: e2e/helpers/localstack.ts
  Export: seedExpense(item), seedGroup(item), cleanTable(pkPrefix) — wraps DynamoDB
  directly via localstack-client pattern (endpoint: http://localhost:4566, region: us-east-1,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' }).
  Commit: /commit-fix e2e-setup-helpers

TASK 5 — Create base fixture
  File: e2e/fixtures/base.ts
  Use test.extend() to create a base fixture that:
  - Calls loginAsMockUser(page) in beforeEach automatically
  - Exposes apiClient and localstack helpers as fixture properties
  Export: { test, expect } from this file (re-export Playwright's test extended with fixtures)
  Commit: /commit-fix e2e-setup-fixtures

TASK 6 — Create smoke spec to verify setup works
  File: e2e/specs/smoke.spec.ts
  One test: navigate to '/', assert page title includes "CostsCrunch" or similar.
  This verifies Playwright can reach the dev server.
  Run: npm run test:e2e (confirm it passes or the webServer starts correctly)
  Commit: /commit-fix e2e-setup-smoke

After all tasks are committed:
Flag the human to push and open a PR. Target branch: main.
Title: feat(test): e2e-setup — install Playwright, configure base fixtures and auth helper
Update ai/WORKTREES.md row test/e2e-setup → status: pr open
```

---

## Phase 0 Primers

### backend-agent · `feat/test/p0-backend-integ`

```
You are the backend-agent for this worktree (feat/test/p0-backend-integ).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "e2e-setup\|playwright"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/__tests__/integration/ — read all existing integration tests to understand patterns
3. backend/__tests__/__helpers__/localstack-client.ts — DynamoDB helpers
4. backend/__tests__/unit/groups.unit.test.ts — existing CON-001/002 unit tests (TEST-001/003 from PR #65)

Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npm run test:ig (LocalStack required)

Your goal: fill integration test gaps not covered by PR #65 (TEST-001–004).
Focus on routes and flows exercised against real LocalStack DynamoDB.

Integration test file: backend/__tests__/integration/p0-backend.integration.test.ts

Tests to write, in order:

CON-001 integration — group join is idempotent under concurrent calls
  Seed a group and user. Call the join handler twice with the same userId in rapid
  succession (Promise.all). Assert only one GROUP_MEMBER# item exists in DynamoDB
  (not two). The ConditionExpression prevents the duplicate.
  /commit-fix TEST-CON-001-integ

CON-002 integration — settlement is atomic: no partial writes on transact failure
  Seed a group with 3 expenses. Mock TransactWriteCommand to reject on the first call
  (TransactionCanceledException), then succeed on retry. Assert: after a failed attempt,
  no expense items have their status changed in DynamoDB (no partial writes).
  Note: TransactWriteCommand rejection must be set up via vi.mock before the handler call.
  /commit-fix TEST-CON-002-integ

PERF-001 integration — analytics returns all items across pagination
  Seed 150+ expense items for a user across multiple DynamoDB pages. Call the analytics
  handler with scope=personal. Assert the response contains all 150+ items (not just the
  first 1MB page). This verifies the ExclusiveStartKey loop works end-to-end.
  /commit-fix TEST-PERF-001-integ

DEP-004 integration — DELETE /auth/account uses JWT identity, not body
  Call the DELETE /auth/account handler via makeApiEvent with userId in the JWT claims
  AND a different userId in the request body. Assert the handler deletes the account
  matching the JWT userId, not the body userId.
  /commit-fix TEST-DEP-004-integ

After all tests pass: cd backend && npm run test:ig
Flag the human to push and open a PR. Target branch: main.
Title: test(integ): p0-backend — CON-001/002, PERF-001, DEP-004 integration coverage
Update ai/WORKTREES.md row test/p0-backend-integ → status: pr open
```

### frontend-agent · `feat/test/p0-frontend-e2e`

```
You are the frontend-agent for this worktree (feat/test/p0-frontend-e2e).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "e2e-setup\|playwright"

Start by reading these files:
1. .agent.md — your full domain context
2. e2e/playwright.config.ts — understand baseURL, webServer, fixtures
3. e2e/fixtures/base.ts — use { test, expect } from here (not from @playwright/test directly)
4. frontend/src/components/scanModal.tsx — FE-005 (receipt scan flow)
5. frontend/src/pages/dashboard.tsx — FE-004 (GroupBudget card)
6. frontend/src/stores/useExpenseStore.ts — FE-001 (isFetched flag)

Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: npm run test:e2e (ensure dev:opt3 is running or webServer starts it)

E2E spec file: e2e/specs/p0-frontend.spec.ts
Import { test, expect } from '../fixtures/base.ts' (not @playwright/test directly).

Specs to write, in order:

FE-004 E2E — Dashboard GroupBudget card renders without crashing
  Navigate to '/dashboard'. Assert the GroupBudget cards are visible.
  Assert they display member counts and spend amounts (not undefined/NaN).
  This verifies the g.memberCount, g.totalSpend fix holds.
  /commit-fix TEST-FE-004-e2e

FE-001 E2E — Navigating away and back does not trigger a redundant fetchExpenses
  On the '/expenses' page, intercept the GET /expenses API call via page.route().
  Count how many times it fires. Navigate to '/dashboard', then back to '/expenses'.
  Assert the expenses API was called at most once (isFetched guard prevents second call).
  /commit-fix TEST-FE-001-e2e

FE-005 E2E — Receipt scan flow completes and populates form
  Stub page.route('**/receipts/upload-url', ...) to return a fake presigned URL.
  Stub page.route('**/receipts/*/scan', ...) to return { status: 'completed', merchant: 'Test Cafe',
  amount: 12.50, category: 'Meals' } after one polling attempt.
  Navigate to '/expenses', open the scan modal, upload a test image file.
  Assert: after polling completes, the merchant, amount, and category fields in the form
  are populated with the mocked scan result values.
  /commit-fix TEST-FE-005-e2e

FE-002 E2E — WebSocket reconnects after simulated disconnect
  This test is best-effort: WebSocket reconnect is hard to trigger deterministically.
  Recommended approach: expose a debug hook on window (e.g., window.__ws_force_close())
  in the useWebSocket hook when process.env.NODE_ENV === 'test', then call it via
  page.evaluate(). Assert the connection status indicator (if visible in the UI)
  transitions from 'connected' → 'disconnected' → 'connected'.
  If no visible indicator exists, assert window.__ws_retry_count > 0 after force-close.
  Mark as test.fixme() if the hook does not exist — add a note in the PR for follow-up.
  /commit-fix TEST-FE-002-e2e

After all specs pass: npm run test:e2e
Flag the human to push and open a PR. Target branch: main.
Title: test(e2e): p0-frontend — FE-001 FE-002 FE-004 FE-005 Playwright coverage
Update ai/WORKTREES.md row test/p0-frontend-e2e → status: pr open
```

---

## Phase 1 Primers

### backend-agent · `feat/test/p1-backend-integ`

```
You are the backend-agent for this worktree (feat/test/p1-backend-integ).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "PERF-002\|SF-002\|SF-004\|SF-005"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/lambdas/expenses/index.ts — PERF-002, SF-004, SF-005
3. backend/src/lambdas/receipts/index.ts — SF-002
4. backend/__tests__/__helpers__/localstack-client.ts — makeApiEvent, cleanTable

Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npm run test:ig

Integration test file: backend/__tests__/integration/p1-backend.integration.test.ts

Specs to write, in order:

PERF-002 integration — GET /expenses/{id} never performs a table scan
  Spy on the DynamoDB client's send() method. Call GET /expenses/{id} via the handler.
  Assert that NO call to send() used ScanCommand (check command constructor name).
  Assert that only QueryCommand or GetCommand was used with the correct pk.
  Seed a real expense item first so the handler returns 200 (not 404).
  /commit-fix TEST-PERF-002-integ

SF-004 integration — DynamoDB errors propagate as real errors (not 404)
  Mock ddb.send() to reject with a ThrottlingException for the first call.
  Assert the handler returns a 5xx status (not 404 "Expense not found").
  This verifies sendCommand is gone and errors propagate through withErrorHandler.
  /commit-fix TEST-SF-004-integ

SF-002 integration — Textract failure writes "failed" status to DynamoDB
  Seed a scan record with status: "processing". Mock StartExpenseAnalysisCommand to throw.
  Call the receipts handler. Assert the scan record in DynamoDB now has status: "failed".
  (Not "processing" — the fix writes the terminal status in the catch block.)
  /commit-fix TEST-SF-002-integ

SF-005 integration — DELETE /expenses/{id} returns 403 for wrong owner, 404 for missing
  Seed an expense owned by userId-A. Call DELETE /expenses/{id} with makeApiEvent
  for userId-B (different user). Assert response is 403 (not 200 or 404).
  Then delete the expense from DynamoDB directly. Call DELETE again as userId-B.
  Assert response is 404.
  /commit-fix TEST-SF-005-integ

After all tests pass: cd backend && npm run test:ig
Flag the human to push and open a PR. Target branch: main.
Title: test(integ): p1-backend — PERF-002 SF-002 SF-004 SF-005 integration coverage
Update ai/WORKTREES.md row test/p1-backend-integ → status: pr open
```

### infra-agent · `feat/test/p1-infra`

```
You are the infra-agent for this worktree (feat/test/p1-infra).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "IaC-007"

Start by reading these files:
1. .agent.md — your full domain context
2. infrastructure/stacks/CostsCrunchStack.ts lines 380–400 — IaC-007 fix area
3. infrastructure/package.json — confirm aws-cdk-lib/assertions is available

Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd infrastructure && npm test

CDK assertion test file: infrastructure/__tests__/p1-stack.test.ts

Specs to write:

IaC-007 CDK assertion — prod template has 2 Redis cache nodes
  Import Template from aws-cdk-lib/assertions.
  Synthesize the stack with context { stage: 'prod' }.
  Assert: template.hasResourceProperties('AWS::ElastiCache::ReplicationGroup', {
    NumCacheClusters: 2,
    AutomaticFailoverEnabled: true,
  })
  Also assert: dev stage has NumCacheClusters: 1 (to confirm the conditional works).
  Synthesize again with context { stage: 'dev' } and assert NumCacheClusters: 1.
  /commit-fix TEST-IaC-007-cdk

After test passes: cd infrastructure && npm test
Flag the human to push and open a PR. Target branch: main.
Title: test(infra): p1-infra — CDK assertion for IaC-007 Redis cluster count
Update ai/WORKTREES.md row test/p1-infra → status: pr open
```

---

## Phase 2 Primers

### backend-agent · `feat/test/p2-backend-perf-integ`

```
You are the backend-agent for this worktree (feat/test/p2-backend-perf-integ).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "CON-003\|CON-004\|PERF-003\|SCALE-001"

Integration test file: backend/__tests__/integration/p2-backend-perf.integration.test.ts
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npm run test:ig

Specs to write, in order:

CON-003 integration — ApiGatewayManagementApiClient is not re-constructed on every call
  Spy on the ApiGatewayManagementApiClient constructor. Trigger notifyUserViaWebSocket
  twice (call the handler with two separate S3 events in one invocation or sequential calls).
  Assert the constructor was called at most once (module-scope construction).
  /commit-fix TEST-CON-003-integ

CON-004 integration — pushToUsers helper fans out to all connections
  Seed 3 connection records for a userId. Call the web-socket-notifier handler.
  Mock ApiGatewayManagementApiClient.send to resolve. Assert send() was called 3 times
  (once per connection) — not 0 or 1. This verifies the fan-out logic in pushToUsers.
  /commit-fix TEST-CON-004-integ

SCALE-001 integration — GET /groups/{id}/balances filters unsettled expenses only
  Seed 5 expenses: 3 with status "pending", 2 with status "reimbursed".
  Call the balances handler. Assert the response balance calculation is based on
  only the 3 pending expenses (not all 5). Verify via DynamoDB query count spy
  that only the filtered items were read.
  /commit-fix TEST-SCALE-001-integ

SCALE-002 integration — analytics scope=all uses a single BatchGetItem (not 1+N)
  Seed 3 group memberships for a user. Spy on ddb.send().
  Call the analytics handler with scope=all. Assert exactly 1 BatchGetItemCommand
  was sent (not 3 individual GetItemCommand calls).
  /commit-fix TEST-SCALE-002-integ

After all tests pass: cd backend && npm run test:ig
PR title: test(integ): p2-backend-perf — CON-003 CON-004 SCALE-001 SCALE-002 integration coverage
```

### backend-agent · `feat/test/p2-backend-safety-integ`

```
You are the backend-agent for this worktree (feat/test/p2-backend-safety-integ).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "SF-006\|SF-007\|SF-008\|SF-009"

Integration test file: backend/__tests__/integration/p2-backend-safety.integration.test.ts
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npm run test:ig

Specs to write, in order:

SF-006 integration — $disconnect removes connection record from DynamoDB
  Seed a connection record in TABLE_NAME_CONNECTIONS with a known connectionId.
  Call the WebSocket handler with a $disconnect event and that connectionId.
  Assert the connection record no longer exists in DynamoDB after the call.
  /commit-fix TEST-SF-006-integ

SF-009 integration — duplicate receipt sets scan status to "duplicate"
  Seed a scan record with status "processing" and a receipt hash that matches a
  previously seen hash in the duplicate GSI.
  Call the sns-webhook handler. Assert the scan record now has status "duplicate"
  (not "processing").
  /commit-fix TEST-SF-009-integ

SIMP-001 integration — userId hardcode only fires when MOCK_AUTH is true
  Unset process.env.MOCK_AUTH (or set to 'false'). Call an expense handler.
  Assert the userId in the DynamoDB write matches the JWT claims userId
  (not the hardcoded test value "test-user-001").
  Then set MOCK_AUTH to 'true'. Assert the userId override applies in that case.
  /commit-fix TEST-SIMP-001-integ

SF-007 integration — partial WS failure emits a warn metric
  Mock ApiGatewayManagementApiClient.send to reject for 1 of 3 connections.
  Spy on logger.warn (or metrics.addMetric). Call the web-socket-notifier handler.
  Assert the warn/metric was emitted with the partial failure count.
  Assert the handler does not throw (partial failures are non-fatal).
  /commit-fix TEST-SF-007-integ

After all tests pass: cd backend && npm run test:ig
PR title: test(integ): p2-backend-safety — SF-006 SF-007 SF-009 SIMP-001 integration coverage
```

### types-agent · `feat/test/p2-types`

```
You are the types-agent for this worktree (feat/test/p2-types).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "TDA-001\|TDA-002\|TDA-003"

Unit test file: backend/__tests__/unit/p2-types.unit.test.ts
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npx tsc --noEmit && npm run test:ut

Tests to write, in order:

TDA-001 unit — ExpenseStatus Zod schema and TypeScript type are in sync
  Import ExpenseStatusSchema and ExpenseStatus from their respective sources.
  Assert ExpenseStatusSchema.parse('pending') succeeds.
  Assert ExpenseStatusSchema.safeParse('invalid').success === false.
  Assert typeof inference: ExpenseStatus includes 'pending' (compile-time, via z.infer).
  /commit-fix TEST-TDA-001

TDA-004 unit — category field rejects invalid strings
  Import CreateExpenseRequestSchema. Call .safeParse({ ...validExpense, category: 'Sushi' }).
  Assert success === false and error path includes 'category'.
  Assert .safeParse({ ...validExpense, category: 'Meals' }).success === true.
  Assert omitting category gives the default 'Other'.
  /commit-fix TEST-TDA-004

TDA-002 compile check — withErrorHandler accepts typed event parameter
  This is a compile-time test. Create a test file with a typed handler:
    const handler = withErrorHandler<MyEvent>(async (event: MyEvent) => { ... })
  Run npx tsc --noEmit and assert no errors. The generic must accept the type parameter.
  If tsc --noEmit passes, the test is: expect(true).toBe(true) with a comment explaining.
  /commit-fix TEST-TDA-002

TDA-003 unit — analyticsRepository.getExpenses returns typed Expense array
  Mock DynamoDBDocumentClient to return known items.
  Call getExpenses(). Assert the return type is Expense[] at runtime (check field names).
  Assert an item with a missing required field throws a Zod validation error (not silently passes).
  /commit-fix TEST-TDA-003

After all tests pass: npx tsc --noEmit && npm run test:ut
PR title: test(types): p2-types — TDA-001 TDA-002 TDA-003 TDA-004 type safety tests
```

### infra-agent · `feat/test/p2-infra`

```
You are the infra-agent for this worktree (feat/test/p2-infra).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "IaC-008\|IaC-014\|IaC-016"

CDK assertion test file: infrastructure/__tests__/p2-stack.test.ts
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd infrastructure && npm test

CDK assertions to write (synthesize with stage: 'prod' unless noted):

IaC-014 — authTriggerLambda has read+write DynamoDB policy
  Assert the IAM role for authTriggerLambda has both dynamodb:GetItem and dynamodb:PutItem
  (or equivalently, dynamodb:* / grantReadWriteData grants both).
  /commit-fix TEST-IaC-014-cdk

IaC-016 — wsNotifierLambda has no duplicate ManageConnections policy
  Assert there is exactly 1 policy statement granting execute-api:ManageConnections
  to the wsNotifierLambda role. Use template.resourceCountIs or filter policy docs.
  /commit-fix TEST-IaC-016-cdk

IaC-011 — imagePreprocessLambda environment includes WEBSOCKET_ENDPOINT
  Assert the imagePreprocessLambda function resource has WEBSOCKET_ENDPOINT in its
  Environment.Variables map (non-empty string, not missing).
  /commit-fix TEST-IaC-011-cdk

IaC-008 — prod stage has provisioned concurrency alias for key Lambdas
  Synthesize with stage: 'prod'. Assert at least one Lambda alias resource exists
  (AWS::Lambda::Alias) with ProvisionedConcurrencyConfig set.
  /commit-fix TEST-IaC-008-cdk

IaC-013 — wsHandlerLambda has a CloudWatch alarm
  Assert at least one AWS::CloudWatch::Alarm resource exists with the wsHandlerLambda's
  function name in its Dimensions.
  /commit-fix TEST-IaC-013-cdk

After all tests pass: cd infrastructure && npm test
PR title: test(infra): p2-infra — CDK assertions for IaC-008 IaC-011 IaC-013 IaC-014 IaC-016
```

### frontend-agent · `feat/test/p2-frontend-e2e`

```
You are the frontend-agent for this worktree (feat/test/p2-frontend-e2e).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "FE-006\|FE-007\|FE-009\|FE-010"

E2E spec file: e2e/specs/p2-frontend.spec.ts
Import { test, expect } from '../fixtures/base.ts'
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: npm run test:e2e

Specs to write, in order:

FE-007 E2E — New group appears in list immediately after creation
  Navigate to '/groups'. Intercept GET /groups to count calls.
  Click create group, fill the form, submit. Assert the new group name appears
  in the groups list without a page reload. Assert GET /groups was called again
  after the create (fetchGroups was triggered).
  /commit-fix TEST-FE-007-e2e

FE-009 E2E — State resets when switching between expenses
  Navigate to expense A detail page. Trigger an error (mock API to return 500 once).
  Assert an error message is visible. Click a different expense B.
  Assert the error message is gone (state was reset on navigation).
  /commit-fix TEST-FE-009-e2e

FE-010 E2E — Network error shows error message, not "Group not found"
  Stub page.route('**/groups/*', route => route.abort('failed')).
  Navigate to a group detail page. Assert the UI shows a network/connection error
  message — NOT "Group not found" (which is reserved for 404).
  /commit-fix TEST-FE-010-e2e

FE-011 E2E — Second mount does not re-fetch groups within 30 seconds
  Navigate to '/dashboard'. Intercept and count GET /groups calls.
  Navigate to '/groups' (second mount of group store). Navigate back.
  Assert GET /groups was called exactly once total (lastFetchedAt guard fired).
  /commit-fix TEST-FE-011-e2e

FE-014 E2E — Analytics category dropdown closes on outside click
  Navigate to '/analytics'. Click the category dropdown to open it.
  Assert dropdown content is visible. Click outside the dropdown (e.g., the page heading).
  Assert dropdown content is no longer visible.
  /commit-fix TEST-FE-014-e2e

After all specs pass: npm run test:e2e
PR title: test(e2e): p2-frontend — FE-007 FE-009 FE-010 FE-011 FE-014 Playwright coverage
```

---

## Phase 3 Primers

### backend-agent · `feat/test/p3-backend-integ`

```
You are the backend-agent for this worktree (feat/test/p3-backend-integ).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "SUG-001\|SUG-002\|SUG-005\|SUG-006"

Unit test file: backend/__tests__/unit/p3-backend.unit.test.ts
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: cd backend && npm run test:ut

These are regression tests — verify behavior is unchanged after the cleanup refactors.

Tests to write:

SUG-001 regression — ok() and err() helpers produce identical output post-move
  Import ok and err from utils/responses.ts (new location).
  Assert ok({ data: true }, 200) produces { statusCode: 200, body: '{"data":true}', headers: {...} }.
  Assert err('Not found', 404) produces { statusCode: 404, body: '{"error":"Not found"}', ... }.
  Import the same helpers from any Lambda that previously defined them locally and
  assert they produce identical output (or confirm the local definition is gone).
  /commit-fix TEST-SUG-001

SUG-002 regression — CSV export output unchanged after exportUtils.ts extraction
  Import stripInternal and CSV_COLUMNS from utils/exportUtils.ts.
  Call stripInternal on a test expense object. Assert the DynamoDB internal keys
  (pk, sk, entityType) are stripped and user-facing fields remain.
  Assert CSV_COLUMNS is a non-empty array of strings.
  /commit-fix TEST-SUG-002

SUG-005 regression — all group routes still resolve after routing table refactor
  Call the groups handler with every known routeKey (GET /groups, GET /groups/{id},
  POST /groups, PUT /groups/{id}, DELETE /groups/{id}, etc.).
  Assert each returns a defined response (not undefined or 404 "Route not found").
  This verifies the routing table covers all routes that segment arithmetic previously handled.
  /commit-fix TEST-SUG-005

After all tests pass: cd backend && npm run test:ut
PR title: test(unit): p3-backend — SUG-001 SUG-002 SUG-005 regression coverage
```

### frontend-agent · `feat/test/p3-frontend-e2e`

```
You are the frontend-agent for this worktree (feat/test/p3-frontend-e2e).
Verify before starting:
  git fetch origin && git log origin/main --oneline | grep -i "FE-016\|FE-020\|FE-022"

E2E spec file: e2e/specs/p3-frontend.spec.ts
Import { test, expect } from '../fixtures/base.ts'
Skill: /commit-fix <TEST-ISSUE-ID>
Test gate: npm run test:e2e

Smoke specs to write:

FE-020 E2E — Dashboard heading shows current month and year (not hardcoded)
  Navigate to '/dashboard'. Assert the month/year heading contains the current
  month name and 4-digit year (not "February 2026").
  Use: const now = new Date(); assert heading contains now.getFullYear().toString().
  /commit-fix TEST-FE-020-e2e

FE-016 E2E — "My Expenses" filter shows current user's expenses
  Seed 2 expenses for the mock user and 1 expense for a different userId.
  Navigate to '/expenses'. Enable the "My Expenses" filter.
  Assert only 2 expenses are shown (not 3). Assert the displayed expenses
  belong to the mock userId (not "You" as a string match).
  /commit-fix TEST-FE-016-e2e

FE-022 E2E — Sort selector accepts all expected values without type errors
  Navigate to '/groups'. For each expected sort option (name, spend, memberCount, date):
  Select the option from the sort dropdown. Assert the UI does not throw or crash.
  Assert the sort option is visually selected.
  /commit-fix TEST-FE-022-e2e

After all specs pass: npm run test:e2e
PR title: test(e2e): p3-frontend — FE-016 FE-020 FE-022 smoke coverage
```
