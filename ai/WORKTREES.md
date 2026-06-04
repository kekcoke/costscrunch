# CostsCrunch — Active Worktrees
> Agents update their row when opening or closing a PR. This is the coordination surface for cross-agent dependencies.

---

## Dependency Tracks

**Track A — Gate ✅ Merged**

| Worktree | Branch | Agent | Issues | PR | Status |
|---|---|---|---|---|---|
| `contract/fix-ac003` | `feat/contract/fix-ac003` | contract-agent | AC-003 | — | merged |

**Track B — Parallel (in progress)**

| Worktree | Branch | Agent | Issues | PR | Status | Depends On |
|---|---|---|---|---|---|---|
| `backend/fix-critical` | `feat/backend/fix-critical` | backend-agent | CON-001, CON-002, PERF-001, DEP-001, DEP-002, DEP-004 | #61 | merged | — |
| `infra/fix-iac` | `feat/infra/fix-iac` | infra-agent | IaC-001, IaC-002, IaC-003, IaC-004, IaC-005, IaC-006 | #62 | merged | — |
| `cicd/fix-security` | `feat/cicd/fix-security` | cicd-agent | SEC-001, SEC-002, BUG-001, BUG-002, CON-CI-001, CON-CI-002 | #64 | merged | — |
| `frontend/fix-critical` | `feat/frontend/fix-critical` | frontend-agent | FE-001, FE-002, FE-004, FE-005 | #63 | merged | — |
| `qa/fix-coverage` | `feat/qa/fix-coverage` | qa-agent | TEST-001, TEST-002, TEST-003, TEST-004 | #65 | pr open | backend PR |

---

## Merge Order

1. `contract/fix-ac003` — gate; unblocks backend group queries and FE-004
2. `cicd/fix-security` — independent; no shared files with other tracks
3. `infra/fix-iac` — independent; IaC-004 must land before backend DEP-001 is verified
4. `backend/fix-critical` — after contract gate
5. `frontend/fix-critical` — after contract gate
6. `qa/fix-coverage` — after backend PR merges (tests written against fixed logic)

---

## Cross-Agent Coordination Rules

- **Contract gate check** — before starting blocked worktrees, verify: `git fetch origin && git log origin/main --oneline | grep -i "AC-003\|contract"`
- **Shared types** — any change to `shared/src/api/types.ts` requires contract-agent sign-off. Add a row here before opening the PR.
- **IaC-004 / DEP-001** — same env var (`BUCKET_ASSETS_NAME`) from two angles. infra-agent has landed the CDK side (IaC-004 merged); backend-agent can now verify DEP-001 in integration tests. `BUCKET_ASSETS_NAME` is in `sharedEnv`, both SAM templates, setup.sh, and bootstrap.sh.
- **LocalStack** — shared singleton. The first agent to need it calls `docker compose up -d`; all others poll health first. See `ai/agents/localstack-agent.md §9`.

---

## Status Key

| Status | Meaning |
|---|---|
| `ready` | Worktree exists, no blocking dependency — open a session and start |
| `in progress` | Active Claude Code session running |
| `blocked` | Waiting on a dependency to merge |
| `pr open` | PR submitted, awaiting review |
| `merged` | PR merged to main |

---

## Phase 1 — Critical (3 worktrees · all parallel)

> Open all three immediately. Details: `ai/phases/PHASE-1-CRITICAL.md` · Primers: `ai/phases/primers/phase-1-primers.md`

| Worktree | Branch | Agent | Issues | PR | Status |
|---|---|---|---|---|---|
| `p1/backend-critical` | `feat/p1/backend-critical` | backend-agent | PERF-002, SF-002, SF-004, SF-005 | — | merged |
| `p1/infra-critical` | `feat/p1/infra-critical` | infra-agent | IaC-007 | #68 | merged |
| `p1/cicd-critical` | `feat/p1/cicd-critical` | cicd-agent | BUG-001, BUG-002, BUG-003 | #70 | pr open |

---

## Phase 2 — Important (7 worktrees · rolling unblock)

> Each row unblocks when its Phase 1 dependency merges. Details: `ai/phases/PHASE-2-IMPORTANT.md` · Primers: `ai/phases/primers/phase-2-primers.md`

| Worktree | Branch | Agent | Issues | PR | Status | Depends On |
|---|---|---|---|---|---|---|
| `p2/backend-perf` | `feat/p2/backend-perf` | backend-agent | CON-003, CON-004, PERF-003, PERF-004, SCALE-001, SCALE-002, SCALE-003 | — | pr open | p1/backend-critical |
| `p2/backend-safety` | `feat/p2/backend-safety` | backend-agent | SF-006, SF-007, SF-008, SF-009, SIMP-001, SIMP-002, OPS-001, DEP-003 | #71 | merged | p1/backend-critical |
| `p2/types` | `feat/p2/types` | types-agent | TDA-001, TDA-002, TDA-003, TDA-004, TDA-005 | — | pr open | p1/backend-critical |
| `p2/infra` | `feat/p2/infra` | infra-agent | IaC-008, IaC-009, IaC-010, IaC-011, IaC-012, IaC-013, IaC-014, IaC-015, IaC-016, IaC-017, IaC-018 | — | pr open | p1/infra-critical |
| `p2/cicd` | `feat/p2/cicd` | cicd-agent | SEC-003, SEC-004, BUG-004, BUG-005, BUG-006, BUG-007, BUG-008, CONF-001, CONF-002 | — | blocked | p1/cicd-critical |
| `p2/frontend` | `feat/p2/frontend` | frontend-agent | FE-006, FE-007, FE-008, FE-009, FE-010, FE-011, FE-012, FE-013, FE-014 | — | blocked | p1/backend-critical |
| `p2/qa` | `feat/p2/qa` | qa-agent | TEST-003, TEST-004 | — | blocked | p2/backend-perf + p2/backend-safety |

---

## Phase 3 — Suggested / High-Value (4 worktrees · rolling unblock)

> Details: `ai/phases/PHASE-3-SUGGESTED.md` · Primers: `ai/phases/primers/phase-3-primers.md`

| Worktree | Branch | Agent | Issues | PR | Status | Depends On |
|---|---|---|---|---|---|---|
| `p3/backend-cleanup` | `feat/p3/backend-cleanup` | backend-agent | SUG-001–006 (backend), deploy-SUG-004 | — | blocked | p2/backend-perf + p2/backend-safety |
| `p3/infra-cleanup` | `feat/p3/infra-cleanup` | infra-agent | IaC-019, IaC-020, IaC-021, IaC-022, IaC-024 | — | blocked | p2/infra |
| `p3/cicd-cleanup` | `feat/p3/cicd-cleanup` | cicd-agent | cicd-SUG-001, SUG-002, SUG-005, SUG-007 | — | blocked | p2/cicd |
| `p3/frontend-cleanup` | `feat/p3/frontend-cleanup` | frontend-agent | FE-015, FE-016, FE-018, FE-020, FE-022 | — | blocked | p2/frontend |

---

## Test Worktrees — E2E Setup (prerequisite · open immediately)

> Must merge before any E2E test worktree opens. Details: `ai/phases/TEST-COVERAGE.md` · Primers: `ai/phases/primers/test-primers.md` → E2E Setup section

| Worktree | Branch | Agent | Type | PR | Status | Depends On |
|---|---|---|---|---|---|---|
| `test/e2e-setup` | `feat/test/e2e-setup` | frontend-agent | Playwright setup | — | ready | — |

---

## Test Worktrees — Phase 0 (retroactive · opens after e2e-setup merges)

> Details: `ai/phases/TEST-COVERAGE.md` · Primers: `ai/phases/primers/test-primers.md` → Phase 0 section

| Worktree | Branch | Agent | Type | Issues Verified | PR | Status | Depends On |
|---|---|---|---|---|---|---|---|
| `test/p0-backend-integ` | `feat/test/p0-backend-integ` | backend-agent | Vitest + LocalStack | CON-001, CON-002, PERF-001, DEP-001, DEP-002, DEP-004 | — | blocked | test/e2e-setup |
| `test/p0-frontend-e2e` | `feat/test/p0-frontend-e2e` | frontend-agent | Playwright | FE-001, FE-002, FE-004, FE-005 | — | blocked | test/e2e-setup |

---

## Test Worktrees — Phase 1 (opens after Phase 1 fix PRs merge + e2e-setup)

> Details: `ai/phases/TEST-COVERAGE.md` · Primers: `ai/phases/primers/test-primers.md` → Phase 1 section

| Worktree | Branch | Agent | Type | Issues Verified | PR | Status | Depends On |
|---|---|---|---|---|---|---|---|
| `test/p1-backend-integ` | `feat/test/p1-backend-integ` | backend-agent | Vitest + LocalStack | PERF-002, SF-002, SF-004, SF-005 | — | blocked | p1/backend-critical + test/e2e-setup |
| `test/p1-infra` | `feat/test/p1-infra` | infra-agent | CDK assertions | IaC-007 | — | blocked | p1/infra-critical |

---

## Test Worktrees — Phase 2 (domain-parallel · rolling unblock per fix PR)

> Details: `ai/phases/TEST-COVERAGE.md` · Primers: `ai/phases/primers/test-primers.md` → Phase 2 section

| Worktree | Branch | Agent | Type | Issues Verified | PR | Status | Depends On |
|---|---|---|---|---|---|---|---|
| `test/p2-backend-perf-integ` | `feat/test/p2-backend-perf-integ` | backend-agent | Vitest + LocalStack | CON-003, CON-004, PERF-003, SCALE-001, SCALE-002 | — | blocked | p2/backend-perf |
| `test/p2-backend-safety-integ` | `feat/test/p2-backend-safety-integ` | backend-agent | Vitest + LocalStack | SF-006, SF-007, SF-008, SF-009, SIMP-001 | — | blocked | p2/backend-safety |
| `test/p2-types` | `feat/test/p2-types` | types-agent | tsc + Vitest unit | TDA-001, TDA-002, TDA-003, TDA-004, TDA-005 | — | blocked | p2/types |
| `test/p2-infra` | `feat/test/p2-infra` | infra-agent | CDK assertions | IaC-008, IaC-009, IaC-010, IaC-011, IaC-013, IaC-014, IaC-016, IaC-017 | — | blocked | p2/infra |
| `test/p2-frontend-e2e` | `feat/test/p2-frontend-e2e` | frontend-agent | Playwright | FE-006, FE-007, FE-009, FE-010, FE-011, FE-013, FE-014 | — | blocked | p2/frontend |

---

## Test Worktrees — Phase 3 (smoke/regression · opens after Phase 3 fix PRs merge)

> Details: `ai/phases/TEST-COVERAGE.md` · Primers: `ai/phases/primers/test-primers.md` → Phase 3 section

| Worktree | Branch | Agent | Type | Issues Verified | PR | Status | Depends On |
|---|---|---|---|---|---|---|---|
| `test/p3-backend-integ` | `feat/test/p3-backend-integ` | backend-agent | Vitest unit | SUG-001, SUG-002, SUG-005, SUG-006 | — | blocked | p3/backend-cleanup |
| `test/p3-frontend-e2e` | `feat/test/p3-frontend-e2e` | frontend-agent | Playwright smoke | FE-016, FE-020, FE-022 | — | blocked | p3/frontend-cleanup |
