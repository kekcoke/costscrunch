# CostsCrunch — Active Worktrees
> Agents update their row when opening or closing a PR. This is the coordination surface for cross-agent dependencies.

---

## Dependency Tracks

**Track A — Gate (must merge first)**

| Worktree | Branch | Agent | Issues | PR | Status |
|---|---|---|---|---|---|
| `contract/fix-ac003` | `feat/contract/fix-ac003` | contract-agent | AC-003 | — | not started |

**Track B — Parallel (start after AC-003 merges)**

| Worktree | Branch | Agent | Issues | PR | Status | Depends On |
|---|---|---|---|---|---|---|
| `backend/fix-critical` | `feat/backend/fix-critical` | backend-agent | CON-001, CON-002, PERF-001, DEP-001, DEP-002, DEP-004 | — | blocked | AC-003 |
| `infra/fix-iac` | `feat/infra/fix-iac` | infra-agent | IaC-001, IaC-002, IaC-003, IaC-004, IaC-005, IaC-006 | — | not started | — |
| `cicd/fix-security` | `feat/cicd/fix-security` | cicd-agent | SEC-001, SEC-002, BUG-001, BUG-002, CON-CI-001, CON-CI-002 | — | not started | — |
| `frontend/fix-critical` | `feat/frontend/fix-critical` | frontend-agent | FE-001, FE-002, FE-004, FE-005 | — | blocked | AC-003 |
| `qa/fix-coverage` | `feat/qa/fix-coverage` | qa-agent | TEST-001, TEST-002, TEST-003, TEST-004 | — | blocked | backend PR |

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
- **IaC-004 / DEP-001** — same env var (`BUCKET_ASSETS_NAME`) from two angles. infra-agent lands the CDK side; backend-agent verifies in integration tests afterward.
- **LocalStack** — shared singleton. The first agent to need it calls `docker compose up -d`; all others poll health first. See `ai/agents/localstack-agent.md §9`.

---

## Status Key

| Status | Meaning |
|---|---|
| `not started` | Worktree not yet created |
| `in progress` | Active Claude Code session running |
| `blocked` | Waiting on a dependency to merge |
| `pr open` | PR submitted, awaiting review |
| `merged` | PR merged to main |
