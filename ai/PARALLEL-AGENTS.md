# Parallel Agentic Development — Worktree Strategy
> CostsCrunch · Last updated: 2026-06-03

---

## Overview

Each domain agent runs in its own **git worktree** — an isolated checkout of the repo at a separate path on disk. This means multiple Claude Code sessions can edit, test, and commit simultaneously without touching each other's working trees. The hook auto-injects the right agent persona into each worktree so sessions know exactly what domain they own and what bugs to fix.

The 25 open audit findings are batched into six worktrees across two dependency tracks. A **contract gate** must land first because it fixes the shared API type that both backend and frontend depend on. The gate (AC-003) has merged and all six worktrees are live — backend, frontend, infra, and cicd are ready to run in parallel now.

---

## Branch & Merge Diagram

```mermaid
%%{init: { 'theme': 'base', 'gitGraph': {'rotateCommitLabel': false} } }%%
gitGraph LR
   commit id: "worktrees infra"

   branch contract/fix-ac003
   checkout contract/fix-ac003
   commit id: "AC-003: normalize group response"

   checkout main
   branch cicd/fix-security
   checkout cicd/fix-security
   commit id: "SEC-001/002: pin actions, OIDC"
   commit id: "BUG-001/002: rollback creds + health check"

   checkout main
   branch infra/fix-iac
   checkout infra/fix-iac
   commit id: "IaC-001/003/005: deploy blockers"
   commit id: "IaC-002/004/006: WAF, env var, routes"

   checkout main
   merge contract/fix-ac003 tag: "merged ✓"
   merge cicd/fix-security
   merge infra/fix-iac

   branch backend/fix-critical
   checkout backend/fix-critical
   commit id: "CON-001/002: TOCTOU + settlement atomicity"
   commit id: "DEP-001/002/004: env vars + auth security"

   checkout main
   branch frontend/fix-critical
   checkout frontend/fix-critical
   commit id: "FE-001/002: fetch on nav + WS reconnect"
   commit id: "FE-004/005: GroupBudget crash + ScanModal API"

   checkout main
   merge backend/fix-critical
   merge frontend/fix-critical

   branch qa/fix-coverage
   checkout qa/fix-coverage
   commit id: "TEST-001–004: atomicity + pagination + TOCTOU"

   checkout main
   merge qa/fix-coverage
```

**Reading the diagram:**
- `contract/fix-ac003` forks immediately and is the only **gate** — nothing blocked by it can merge until it lands.
- `cicd/fix-security` and `infra/fix-iac` are fully independent — they run in parallel from the start.
- `backend/fix-critical` and `frontend/fix-critical` are shown forking *after* the gate merge, reflecting that their group-related work can only be completed once the shared type is correct.
- `qa/fix-coverage` forks after backend merges — tests are written against the fixed logic.

---

## Worktree Topology

### Track A — Gate ✅ Merged

| Worktree path | Branch | Agent | Issues | Status |
|---|---|---|---|---|
| `costscrunch.worktrees/contract/fix-ac003` | `feat/contract/fix-ac003` | contract-agent | AC-003 | **merged** |

AC-003 fixed: the Group response no longer leaks `pk`, `sk`, or GSI fields. `shared/src/api/types.ts` is the source of truth; backend and frontend now compile against the corrected types.

### Track B — Parallel ▶ Ready

| Worktree path | Branch | Agent | Issues | Status |
|---|---|---|---|---|
| `costscrunch.worktrees/backend/fix-critical` | `feat/backend/fix-critical` | backend-agent | CON-001, CON-002, PERF-001, DEP-001, DEP-002, DEP-004 | **ready** |
| `costscrunch.worktrees/infra/fix-iac` | `feat/infra/fix-iac` | infra-agent | IaC-001–006 | **ready** |
| `costscrunch.worktrees/cicd/fix-security` | `feat/cicd/fix-security` | cicd-agent | SEC-001, SEC-002, BUG-001, BUG-002, CON-CI-001, CON-CI-002 | **ready** |
| `costscrunch.worktrees/frontend/fix-critical` | `feat/frontend/fix-critical` | frontend-agent | FE-001, FE-002, FE-004, FE-005 | **ready** |
| `costscrunch.worktrees/qa/fix-coverage` | `feat/qa/fix-coverage` | qa-agent | TEST-001–004 | ⏳ blocked (backend PR) |

---

## How It Works

### 1. Branch naming drives agent selection

Branches follow the convention `feat/<domain>/<slug>`. The `<domain>` segment maps to an agent file:

```
feat/backend/fix-concurrency  →  ai/agents/backend-agent.md
feat/contract/fix-ac003       →  ai/agents/contract-agent.md
feat/infra/fix-iac            →  ai/agents/infra-agent.md
```

### 2. The WorktreeCreate hook injects the agent context

When you run `/worktree create feat/<domain>/<slug>` in Claude Code, the hook:

1. Creates the git worktree at `../costscrunch.worktrees/<domain>/<slug>`
2. Symlinks `.env.shared` → `.env.shared` and `tsconfig.base.json`
3. Auto-assigns isolated port ranges (Vite: 3000–3009, SAM: 3010–3099)
4. **Detects `<domain>` from the branch name** and writes `.agent.md` at the worktree root — containing the full agent persona + absolute paths to all skill files

`.agent.md` is gitignored and never committed.

### 3. Prime the session once

Open the worktree in a new Claude Code terminal and send this once at the start:

```
"Read .agent.md — that is your agent context for this worktree."
```

The agent then knows: its domain, the files it owns, the open issues it is responsible for, and how to coordinate with other agents.

### 4. Start dev

```bash
cd ../costscrunch.worktrees/<domain>/<slug>
npm run dev:opt3   # LocalStack data + SAM CLI + Vite (recommended)
```

Each worktree runs on its own ports — no collision between parallel sessions.

---

## Coordination Rules

| Rule | Detail |
|---|---|
| **Contract gate** | Before starting group-related work in `backend` or `frontend` worktrees, verify AC-003 is merged: `git fetch origin && git log origin/main --oneline \| grep -i "AC-003"` |
| **Shared API types** | Any change to `shared/src/api/types.ts` requires contract-agent. Flag the dependency in `ai/WORKTREES.md` before opening a PR. |
| **IaC-004 / DEP-001** | Same root cause: `BUCKET_ASSETS_NAME` never injected. infra-agent lands the CDK change; backend-agent verifies in integration tests afterward. Do not merge backend before infra. |
| **LocalStack singleton** | Shared across all worktrees. The first session to need it calls `docker compose up -d`; all others poll health first. See `localstack-agent.md §9` for the POSIX flock implementation. |
| **Worktree status** | Update your row in `ai/WORKTREES.md` when you open a PR or when your status changes. This is the coordination surface — no out-of-band comms needed. |

---

## Merge Order

```
1. contract/fix-ac003    ← gate; unblocks backend + frontend
2. cicd/fix-security     ← independent; no shared files
3. infra/fix-iac         ← independent; IaC-004 must land before backend verifies DEP-001
4. backend/fix-critical  ← after contract gate
5. frontend/fix-critical ← after contract gate
6. qa/fix-coverage       ← after backend (tests written against fixed logic)
```

---

## Issue Inventory by Worktree

### `contract/fix-ac003`
| ID | Severity | Description |
|---|---|---|
| AC-003 | HIGH | Group response leaks `pk`, `sk`, GSI fields to client |

### `backend/fix-critical`
| ID | Severity | Description |
|---|---|---|
| CON-001 | CRITICAL | TOCTOU race in group join — two concurrent requests can bypass member-limit check |
| CON-002 | HIGH | Settlement uses `Promise.all` instead of `TransactWrite` — non-atomic |
| PERF-001 | MEDIUM | Analytics truncates at 100 results with no pagination |
| DEP-001 | HIGH | `BUCKET_ASSETS_NAME` never injected into Lambda env |
| DEP-002 | MEDIUM | Debug route ships in production |
| DEP-004 | CRITICAL | Auth delete reads `userId` from request body instead of JWT |

### `infra/fix-iac`
| ID | Severity | Description |
|---|---|---|
| IaC-001 | CRITICAL | `expense-export` Lambda never deployed |
| IaC-002 | HIGH | WAF CloudWatch log group naming violates `aws-waf-logs-` prefix requirement |
| IaC-003 | CRITICAL | Redis security group has no inbound rules |
| IaC-004 | HIGH | `BUCKET_ASSETS_NAME` never injected to Lambdas (CDK side of DEP-001) |
| IaC-005 | CRITICAL | Cognito post-confirmation trigger missing Lambda permission |
| IaC-006 | HIGH | Missing or mismatched API Gateway routes |

### `cicd/fix-security`
| ID | Severity | Description |
|---|---|---|
| SEC-001 | HIGH | All third-party Actions unpinned (SHA pinning required) |
| SEC-002 | CRITICAL | Static AWS keys instead of OIDC federation |
| BUG-001 | HIGH | Rollback workflow has no AWS credentials |
| BUG-002 | HIGH | Rollback health check exits non-zero |
| CON-CI-001 | MEDIUM | Concurrent deploys not prevented |
| CON-CI-002 | MEDIUM | Parallel CI jobs share single LocalStack DynamoDB state |

### `frontend/fix-critical`
| ID | Severity | Description |
|---|---|---|
| FE-001 | HIGH | `fetchExpenses` fires on every tab navigation |
| FE-002 | HIGH | WebSocket reconnect callback is empty |
| FE-004 | HIGH | Dashboard GroupBudget card crashes |
| FE-005 | CRITICAL | ScanModal never calls the real upload API |

### `qa/fix-coverage`
| ID | Severity | Description |
|---|---|---|
| TEST-001 | HIGH | Settlement atomicity not tested |
| TEST-002 | MEDIUM | Analytics pagination not tested |
| TEST-003 | HIGH | Group join TOCTOU race not tested |
| TEST-004 | MEDIUM | CORS integration coverage incomplete |

---

## Current State & Next Steps

### Status

| Milestone | Status |
|---|---|
| Worktree infrastructure (hook, env, ports) | ✅ complete |
| All 6 worktrees created | ✅ complete |
| AC-003 contract gate merged | ✅ merged |
| backend, frontend gate cleared | ✅ unblocked |
| cicd, infra (always independent) | ✅ ready |
| qa | ⏳ blocked until backend PR merges |

### Start these sessions now

Open each worktree in its own Claude Code terminal. No setup needed — worktrees already exist.

```bash
# Terminal 1
cd ../costscrunch.worktrees/backend/fix-critical

# Terminal 2
cd ../costscrunch.worktrees/frontend/fix-critical

# Terminal 3
cd ../costscrunch.worktrees/infra/fix-iac

# Terminal 4
cd ../costscrunch.worktrees/cicd/fix-security
```

Prime each session once at the start:

```
"Read .agent.md — that is your agent context for this worktree."
```

### When backend PR merges → start qa

```bash
cd ../costscrunch.worktrees/qa/fix-coverage
# "Read .agent.md — that is your agent context for this worktree."
```

### Track live status

```bash
cat ai/WORKTREES.md
```

See also: `ai/WORKTREES.md` (live status), `ai/skills/SKILLS.md §6` (full workflow details).
