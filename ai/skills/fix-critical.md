# CostsCrunch — fix-critical.md
## Protocol: Triage and Fix a Critical Audit Finding

> Use this skill when working on any finding from the 2026-05-30 audit files.
> Always check `ai/skills/SKILLS.md` Section 0 to route to the correct domain agent first.

---

## 1. Triage Protocol

### Step 1 — Identify the finding

Reference the audit ID and source file:

| Audit domain | Source file |
|---|---|
| Backend concurrency / performance / deployment | `notes/2026-05-30-backend-audit-2.md` |
| Deployment gaps / type safety / security | `notes/2026-05-30-deployment-audit.md` |
| Infrastructure / CDK / routing | `notes/2026-05-30-infrastructure-audit.md` |
| GitHub Actions / CI/CD | `notes/2026-05-30-github-actions-audit.md` |
| Frontend / React / state | `notes/2026-05-30-frontend-audit.md` |

### Step 2 — Route to the correct agent

| Audit ID prefix | Agent file |
|---|---|
| CON-*, PERF-*, DEP-* | `ai/agents/backend-agent.md` |
| FE-* | `ai/agents/frontend-agent.md` |
| IaC-* | `ai/agents/infra-agent.md` |
| SEC-*, BUG-* (CI/CD) | `ai/agents/cicd-agent.md` |
| TEST-* | `ai/agents/qa-agent.md` |

### Step 3 — Verify the finding is still open

Before starting: read the affected file to confirm the bug still exists. Audit findings may already be fixed on a feature branch. Check `git log --oneline -20` for recent commits on the finding.

---

## 2. Fix Execution

### Step 4 — Create a branch
```bash
git checkout main
git pull  # ensure up-to-date (human must approve push, but you can pull)
git checkout -b fix/<domain>/<audit-id>
# e.g.: git checkout -b fix/backend/CON-001
```

### Step 5 — Read before writing

Always read:
1. The full audit finding (re-read the relevant section of the audit note)
2. The affected source file(s)
3. The existing tests for those files

Never edit from memory alone.

### Step 6 — Apply a minimal fix

Rules:
- Fix ONLY the root cause described in the audit finding
- Do not refactor surrounding code unless it is directly part of the fix
- Do not add features or change unrelated behavior
- If the fix requires a coordinated change in another domain (e.g., backend + CDK), document the dependency and note it for the other agent — do not try to fix both domains in one branch unless they are trivially coupled

### Step 7 — Write or update the test

Every fix needs a test that would have caught the bug:
- Backend: add a unit test in `backend/__tests__/unit/<lambda>.unit.test.ts`
- Frontend: add a test in `frontend/__tests__/components.test.tsx`
- Infrastructure: add assertion in `infrastructure/__tests__/`

The test must fail on the unfixed code and pass on the fixed code.

### Step 8 — Run domain tests (gate before commit)

```bash
# Backend fixes
cd backend && npm run test:ut

# Frontend fixes
cd frontend && npx vitest run

# Infrastructure fixes
cd infrastructure && npm run synth && npm test
```

**Do not commit if any test is red.**

### Step 9 — Commit

```bash
git add <specific files only — never git add -A without reviewing>
git commit -m "fix: <one-line description> (resolves <audit-id>)"
```

Commit message examples:
```
fix: use conditional expression to prevent duplicate group members (resolves CON-001)
fix: replace Promise.all with TransactWrite for atomic settlement (resolves CON-002)
fix: remove /debug/500 route that leaks internal stack traces (resolves DEP-002)
fix: read account identity from JWT claims, not request body (resolves DEP-004)
infra: add expense-export Lambda and API Gateway route to CDK stack (resolves IaC-001)
infra: add Redis security group inbound rule on port 6379 (resolves IaC-003)
```

### Step 10 — Document

1. Update `changelog/YYYY-MM-DD.md` with a one-line entry for the fix
2. If the bug was subtle or surprising, add an entry to `ai/skills/SKILLS.md` Section 6 (Common Pitfalls)

---

## 3. Priority Triage Order

Fix in this order — deploy blockers and security issues first:

| # | Audit ID | Description | Domain | Severity |
|---|----------|-------------|--------|----------|
| 1 | IaC-001 | `expense-export` Lambda never deployed — entire export feature missing from CDK | infra-agent | Deploy blocker |
| 2 | IaC-003 | Redis security group has zero inbound rules — all Lambda→Redis connections timeout | infra-agent | Deploy blocker |
| 3 | IaC-005 | Cognito post-confirmation trigger missing `InvokeFunction` permission — new user registration broken | infra-agent | Deploy blocker |
| 4 | DEP-004 | DELETE /auth/account reads identity from request body — privilege escalation vulnerability | backend-agent | Security critical |
| 5 | BUG-001 | Rollback workflow has no AWS credentials — `rollback-stack` silently fails | cicd-agent | Deploy safety |
| 6 | FE-005 | `ScanModal` runs a simulated scan — real receipt API never called | frontend-agent | Core feature broken |
| 7 | CON-001 | TOCTOU race in group join — duplicate member records possible under load | backend-agent | Data integrity |
| 8 | CON-002 | Settlement uses `Promise.all` — partial writes possible on concurrent failure | backend-agent | Data integrity |
| 9 | FE-002 | WebSocket reconnect callback is empty — connection permanently dead after disconnect | frontend-agent | Core feature broken |
| 10 | SEC-001 | All third-party GitHub Actions unpinned — supply chain risk | cicd-agent | Security |

### Secondary issues (fix after deploy blockers are resolved):

| Audit ID | Description | Domain |
|----------|-------------|--------|
| IaC-002 | WAF log group name violates AWS naming convention | infra-agent |
| IaC-004 | `BUCKET_ASSETS_NAME` never injected into Lambda env | infra-agent |
| IaC-006 | 5 API Gateway routes missing or mismatched | infra-agent |
| PERF-001 | Analytics queries silently truncated at 1MB — missing DynamoDB pagination | backend-agent |
| PERF-002 | GET/PATCH expenses fall back to full table scan — O(N) cost | backend-agent |
| FE-001 | `fetchExpenses` fires on every tab navigation | frontend-agent |
| FE-003 | `GuestScanWidget` reads wrong property (`extractedData` vs direct fields) | frontend-agent |
| FE-004 | Dashboard GroupBudget card uses wrong property names — crashes | frontend-agent |
| SEC-002 | Long-lived AWS static keys in CI — OIDC is dead code | cicd-agent |
| BUG-002 | Rollback health check exits non-zero — rollback step unreachable | cicd-agent |
| DEP-001 | `BUCKET_ASSETS_NAME` missing from expenses Lambda CDK env block | infra-agent |
| DEP-002 | Debug `/debug/500` route ships in production — leaks internals | backend-agent |
| TEST-001 | No test for settlement atomicity partial failure | qa-agent |
| TEST-002 | Analytics pagination not tested | qa-agent |
| TEST-003 | Group join TOCTOU race not tested | qa-agent |
| TEST-004 | CORS integration test coverage incomplete | qa-agent |

---

## 4. Cross-Domain Fix Dependencies

Some fixes require coordinated changes across two domains. Note these before starting:

| Fix | Primary | Dependency |
|-----|---------|-----------|
| IaC-001 (expense-export deployed) | infra-agent | Verify `backend/src/lambdas/expense-export/index.ts` exists and is complete |
| IaC-004 / DEP-001 (BUCKET_ASSETS_NAME) | infra-agent | backend-agent confirms the Lambda actually reads this env var |
| CON-001 (TOCTOU) | backend-agent | qa-agent adds concurrency test after fix |
| CON-002 (settlement atomicity) | backend-agent | qa-agent adds atomicity test after fix |
| FE-005 (ScanModal real API) | frontend-agent | Requires receipts Lambda to be working — verify with backend-agent |

---

## 5. Handoff Template

When completing a fix that has a downstream dependency, leave this note in the commit body or a `notes/` file:

```
HANDOFF to <agent>:
- This fix resolves <audit-id> on the <domain> side.
- The complementary change needed: <description>
- Files to edit: <paths>
- Verify with: <test command>
```
