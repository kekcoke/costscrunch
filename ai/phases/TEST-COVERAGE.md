# Test Coverage — All Phases

> **12 test worktrees · domain-parallel per phase gate · opens after Phase 3 completes**
> Retroactive (Phase 0) and prospective (Phases 1–3) coverage using Playwright E2E + Vitest + LocalStack integration + CDK assertions.

---

## Tooling Overview

| Tool | Scope | Run command |
|---|---|---|
| Playwright (`@playwright/test`) | Browser E2E against SAM + LocalStack | `npm run test:e2e` (root) |
| Vitest + LocalStack | Backend Lambda integration | `cd backend && npm run test:ig` |
| Vitest unit | Types, unit-level regression | `cd backend && npm run test:ut` |
| CDK assertions (`aws-cdk-lib/assertions`) | Infrastructure template verification | `cd infrastructure && npm test` |

---

## Prerequisite: E2E Setup Worktree

**Must merge before any E2E test worktree opens.** Opens immediately (no fix phase dependency).

| Worktree | Branch | Agent | Status |
|---|---|---|---|
| `test/e2e-setup` | `feat/test/e2e-setup` | frontend-agent | ready |

**Creates:**
- `e2e/playwright.config.ts` — baseURL `http://localhost:3000`, webServer `npm run dev:opt3`, Chromium only
- `e2e/helpers/auth.ts` — `loginAsMockUser(page)` injects `cc_access_token` into localStorage (MOCK_AUTH=true, no Cognito)
- `e2e/helpers/api.ts` — typed HTTP client for test seeding/teardown
- `e2e/helpers/localstack.ts` — DynamoDB seed wrapper (reuses `backend/__tests__/__helpers__/localstack-client.ts` pattern)
- `e2e/fixtures/base.ts` — `test.extend()` with auth, apiClient, seed fixtures
- `e2e/` entry in root `package.json` workspaces; adds `@playwright/test` devDependency; adds `"test:e2e": "playwright test"` script

**Mocking Textract/Bedrock in E2E:** use `page.route('**/receipts/*/scan', ...)` to stub scan completion responses. Textract/Bedrock are not available in LocalStack free tier.

**Auth strategy:** `MOCK_AUTH=true` in `.env.dev` makes backend inject `sub: "00000000-0000-0000-0000-test-user-001"`. Frontend bypasses Cognito in local dev. E2E tests set `cc_access_token` in localStorage to prevent /login redirects.

---

## Phase 0 — Retroactive Test Worktrees

> Opens after `test/e2e-setup` merges. Both open simultaneously.

| Worktree | Branch | Agent | Test type | Issues verified |
|---|---|---|---|---|
| `test/p0-backend-integ` | `feat/test/p0-backend-integ` | backend-agent | Vitest + LocalStack | CON-001/002, PERF-001, DEP-001/002/004 gaps not covered by PR #65 |
| `test/p0-frontend-e2e` | `feat/test/p0-frontend-e2e` | frontend-agent | Playwright | FE-001, FE-002, FE-004, FE-005 |

Primers: `ai/phases/primers/test-primers.md` → Phase 0 section

---

## Phase 1 — Critical Test Worktrees

> Opens after Phase 1 fix PRs merge + `test/e2e-setup` merged. No CI/CD test worktree (GitHub Actions workflows verified manually).

| Worktree | Branch | Agent | Test type | Issues verified |
|---|---|---|---|---|
| `test/p1-backend-integ` | `feat/test/p1-backend-integ` | backend-agent | Vitest + LocalStack | PERF-002, SF-002, SF-004, SF-005 |
| `test/p1-infra` | `feat/test/p1-infra` | infra-agent | CDK assertions | IaC-007 |

Primers: `ai/phases/primers/test-primers.md` → Phase 1 section

---

## Phase 2 — Important Test Worktrees

> Domain-parallel, rolling unblock. Each opens when its Phase 2 source fix PR merges.

| Worktree | Branch | Agent | Test type | Issues verified | Unblocks after |
|---|---|---|---|---|---|
| `test/p2-backend-perf-integ` | `feat/test/p2-backend-perf-integ` | backend-agent | Vitest + LocalStack | CON-003, CON-004, PERF-003, SCALE-001, SCALE-002 | `p2/backend-perf` |
| `test/p2-backend-safety-integ` | `feat/test/p2-backend-safety-integ` | backend-agent | Vitest + LocalStack | SF-006, SF-007, SF-008, SF-009, SIMP-001 | `p2/backend-safety` |
| `test/p2-types` | `feat/test/p2-types` | types-agent | tsc + Vitest unit | TDA-001–005 | `p2/types` |
| `test/p2-infra` | `feat/test/p2-infra` | infra-agent | CDK assertions | IaC-008–011, IaC-013, IaC-014, IaC-016, IaC-017 | `p2/infra` |
| `test/p2-frontend-e2e` | `feat/test/p2-frontend-e2e` | frontend-agent | Playwright | FE-006, FE-007, FE-009, FE-010, FE-011, FE-013, FE-014 | `p2/frontend` |

Primers: `ai/phases/primers/test-primers.md` → Phase 2 section

---

## Phase 3 — Suggested Test Worktrees

> Opens after Phase 3 fix PRs merge per domain. Smoke/regression focus only.

| Worktree | Branch | Agent | Test type | Issues verified | Unblocks after |
|---|---|---|---|---|---|
| `test/p3-backend-integ` | `feat/test/p3-backend-integ` | backend-agent | Vitest unit | SUG-001, SUG-002, SUG-005, SUG-006 | `p3/backend-cleanup` |
| `test/p3-frontend-e2e` | `feat/test/p3-frontend-e2e` | frontend-agent | Playwright smoke | FE-016, FE-020, FE-022 | `p3/frontend-cleanup` |

Primers: `ai/phases/primers/test-primers.md` → Phase 3 section

---

## Worktree Lifecycle

### Verify unblock before creating

```bash
git fetch origin
# For E2E worktrees: confirm e2e-setup merged
git log origin/main --oneline | grep -i "e2e-setup\|playwright"
# For phase N test worktrees: confirm the fix PR merged
git log origin/main --oneline | grep -i "<issue-id-from-that-phase>"
```

### Create

```bash
# Manual fallback (WorktreeCreate/EnterWorktree preferred):
git fetch origin
git worktree add -b feat/test/e2e-setup          ../costscrunch-test-e2e-setup    main
git worktree add -b feat/test/p0-backend-integ   ../costscrunch-test-p0-backend   main
git worktree add -b feat/test/p0-frontend-e2e    ../costscrunch-test-p0-frontend  main
# ... etc per table above
```

### Open a session

```bash
# 1. Read .agent.md
# 2. Read ai/phases/primers/test-primers.md → find your section
# 3. For backend integration: ensure LocalStack is healthy before running tests
#    (use POSIX flock guard from ai/agents/localstack-agent.md §9)
# 4. For E2E: ensure npm run dev:opt3 is running OR let playwright webServer start it
```

### During work

```
- Write tests for each issue in the order listed in your primer
- After each test file: run the domain test command to confirm green
- Call /commit-fix <TEST-ISSUE-ID> after each test file passes
- Coverage must not regress below thresholds
```

### Close (after PR merges)

```bash
git worktree remove ../costscrunch-test-p0-backend  # repeat for each
git branch -d feat/test/p0-backend-integ
# Update ai/WORKTREES.md row → 'merged'
```

---

## Integration Test Conventions

- Reuse `backend/__tests__/__helpers__/localstack-client.ts` — do not reconfigure AWS clients
- `maxWorkers: 1` enforced in `backend/vite.config.ts` — serial execution, no extra config needed
- Mock Textract, Bedrock, ApiGatewayManagementApi with `vi.mock()` (see existing `receipts.integration.test.ts`)
- Seed: `PutCommand` in `beforeAll`; clean: `cleanTable(prefix)` in `afterAll`
- New files go in `backend/__tests__/integration/<name>.integration.test.ts`

## CDK Assertion Conventions

- Import: `import { Template } from 'aws-cdk-lib/assertions'`
- Synthesize with prod context: `new App({ context: { stage: 'prod' } })`
- Use `template.hasResourceProperties(...)` for positive assertions
- New files go in `infrastructure/__tests__/<name>.test.ts`
- Run: `cd infrastructure && npm test`

## E2E Conventions

- All specs go in `e2e/specs/<phase>-<domain>.spec.ts`
- Use `base.ts` fixtures for auth + seed (no raw `page.evaluate` in specs)
- Use `page.route(...)` to mock Textract/Bedrock at API boundary
- `webServer.reuseExistingServer: !process.env.CI` — local dev reuses running stack
- Do not hardcode wait times; use `page.waitForResponse()` or `expect(locator).toBeVisible()`
