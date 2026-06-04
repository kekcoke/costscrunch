# CostsCrunch — SKILLS.md
## Index & Project Conventions
> Last updated: 2026-06-02.

---

## 0. Navigation Index
> **Start here.** Load `ai/system/system-prompt.md` first in every session, then follow the routing table below.

### Shared system context (inject into every session)
```
ai/system/system-prompt.md
```
Contains: project identity, stack versions, DynamoDB key patterns, Lambda handler contract, autonomy gates, commit conventions.

### Agent routing (domain → agent file → audit IDs owned)

| Domain | Agent file | Audit IDs |
|--------|-----------|-----------|
| Backend — Lambda, DynamoDB, business logic | `ai/agents/backend-agent.md` | CON-001, CON-002, PERF-001, PERF-002, DEP-001, DEP-002, DEP-004 |
| Frontend — React 19, Zustand, WebSocket | `ai/agents/frontend-agent.md` | FE-001, FE-002, FE-003, FE-004, FE-005 |
| API contract — shared response types | `ai/agents/contract-agent.md` | AC-001, AC-002, AC-003, AC-004, AC-005, AC-006 |
| Infrastructure — CDK v2, AWS, routing | `ai/agents/infra-agent.md` | IaC-001, IaC-002, IaC-003, IaC-004, IaC-005, IaC-006 |
| CI/CD — GitHub Actions, OIDC, rollback | `ai/agents/cicd-agent.md` | SEC-001, SEC-002, BUG-001, BUG-002, CON-CI-001, CON-CI-002 |
| QA — Vitest, LocalStack, coverage | `ai/agents/qa-agent.md` | TEST-001, TEST-002, TEST-003, TEST-004 |
| Local dev / LocalStack → Ministack migration | `ai/agents/localstack-agent.md` | — |

### Skills index (task → skill file)

| Task | Skill file |
|------|-----------|
| Execute any fix (branch, commit, document) | `ai/skills/dev-workflow.md` |
| Fix a critical audit finding (triage, priority order) | `ai/skills/fix-critical.md` |
| Add a Lambda endpoint | `ai/skills/add-lambda-endpoint.md` |
| Add a React component or page | `ai/skills/add-frontend-component.md` |
| Write Vitest tests / mock patterns | `ai/skills/write-vitest-tests.md` |
| Write or migrate Terraform | `ai/skills/terraform.md` |
| Migrate LocalStack to ministack | `ai/skills/localstack-to-ministack.md` |
| Run parallel agent sessions across worktrees | `ai/skills/SKILLS.md §6` + `ai/WORKTREES.md` |

### Audit source files (2026-05-30)

| Domain | Audit notes file |
|--------|----------------|
| Backend concurrency / performance | `notes/2026-05-30-backend-audit-2.md` |
| Deployment gaps / type safety | `notes/2026-05-30-deployment-audit.md` |
| Infrastructure / CDK | `notes/2026-05-30-infrastructure-audit.md` |
| GitHub Actions / CI/CD | `notes/2026-05-30-github-actions-audit.md` |
| Frontend / React / state | `notes/2026-05-30-frontend-audit.md` |

---

## 1. Project Conventions

Conventions that don't belong to a single agent or skill file.

### 1.1 Auth Flow

```
Login  →  POST /auth/login
  ├── mfaRequired: false  →  { accessToken }  (store in useAuthStore.token — memory only)
  └── mfaRequired: true   →  { mfaSessionToken }  →  POST /auth/mfa/verify  →  { accessToken }

OAuth  →  loginWithOAuth(provider)
  └── redirect Cognito Hosted UI  →  GET /auth/oauth/callback  →  Set-Cookie + redirect /#access_token=...

Token refresh  →  automatic on 401 in apiFetch()
  └── POST /auth/refresh (refresh_token httpOnly cookie sent automatically)
```

### 1.2 Statement Import Pipeline

```
File arrives → size check:
  < 1 MB   →  POST /statements/import (body = raw bytes)
  >= 1 MB  →  GET /statements/upload-url → PUT presigned S3 → POST /statements/import { s3Key }

Server-side:
  CSV  →  parseCSV()  →  column detection via alias sets  →  rowToExpense()
  PDF  →  S3 object  →  Textract DetectDocumentText  →  parsePDFText()  →  rowToExpense()
       (heuristic: DATE_PATTERN + AMOUNT_PATTERN on each text line)

rowToExpense()  →  inferCategory()  →  batchWriteExpenses() (BatchWrite, 25/chunk)
```

Note: `rowToExpense()` returns `null` for amount ≤ 0 — statement import silently skips negative rows.

### 1.3 Analytics Chart Types

| Type | Component | Notes |
|------|-----------|-------|
| Donut | Custom SVG `DonutChart` | No Recharts |

Chart switching uses `React.startTransition` — old chart stays visible until new one is ready.

### 1.4 Troubleshooting Protocol

When debugging a cross-environment inconsistency:
1. **Command Logging** — record exact commands used to reproduce (`cd infrastructure && npx vitest run __tests__/Specific.test.ts`)
2. **Investigation Depth** — use `grep`, `find`, `jq`, `env`, `Annotations.fromStack`, log tracing, and `git diff`
3. **Troubleshooting Summary** — create `notes/YYYY-MM-DD-<context>-tb.md` with: Problem Statement, Commands Used, Root Cause, Final Solution
4. **Knowledge Loop** — if a new pitfall is found, add to §2 Common Pitfalls below

### 1.5 Testing Quick Reference

```bash
# Backend unit tests (no LocalStack needed)
cd backend && npm run test:ut

# Backend integration tests (LocalStack required)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd backend && npm run test:ig

# Infrastructure LocalStack tests
cd infrastructure && npm test

# Frontend Vitest
cd frontend && npx vitest run

# Coverage
cd backend && npm run test:coverage
cd frontend && npx vitest run --coverage
```

Full mock patterns (aws-sdk-client-mock, RTL, LocalStack afterAll): `ai/skills/write-vitest-tests.md`

---

## 2. Common Pitfalls

> Add new entries here when a non-obvious bug or constraint is discovered.

1. **Token storage** — access tokens go in `useAuthStore.token` (memory only). Never suggest `localStorage`.
2. **DynamoDB keys** — always include PK, SK, and all applicable GSI keys on writes. Missing a GSI key breaks queries.
3. **Cognito error names** — map exception names to user-friendly messages; never return raw Cognito errors.
4. **Statement import skips negatives** — `rowToExpense()` returns `null` for `amount <= 0`.
5. **Chart switching** — use `startTransition` so the old chart stays visible during the React state transition.
6. **Vitest vs Jest** — use `vi.*` everywhere. Module-level `vi.mock()` goes at the top of the file, before any `describe` block.
7. **BatchWrite limits** — DynamoDB `BatchWriteItem` max 25 items per call. `batchWriteExpenses()` already chunks — don't bypass it.
8. **PDF parsing is heuristic** — `parsePDFText()` works for most bank PDFs but may miss rows in complex multi-column layouts.
9. **Infrastructure synchronization** — any CDK change to env vars, S3 buckets, or Lambda config must be mirrored in `setup.sh`, `bootstrap.sh`, SAM template, and `.env.test`. See `ai/system/system-prompt.md §6` for the full rule.
10. **LocalStack API ID changes on restart** — no persistent volume by default; `API_ID` in `.env.dev` must be refreshed after `docker compose down`.
11. **SAM v1.155 socket bug** — use `--docker-network costscrunch-local` workaround; do not use `--container-host`. See `notes/sam.md`.
12. **getAuth identity is JWT-only** — never read `userId` from request body; always `getAuth(event).userId`.
13. **API response shapes vs DynamoDB entity shapes** — `backend/src/shared/models/types.ts` contains DynamoDB entity types (with `pk`, `sk`, `gsi*` fields). These must never be returned directly from a Lambda. API response shapes (what the frontend receives) live in `shared/src/api/types.ts` (`@costscrunch/api`). Always apply a `*ToResponse()` normalization function before calling `ok()`. Skipping normalization leaks DynamoDB internals and produces frontend type mismatches (e.g., FE-003). See `ai/agents/contract-agent.md`.

---

## 3. Environment Variable Management

To ensure consistency across Docker, Vitest, and frontend/backend, follow the **Centralized Source** pattern.

### 3.1 Single Source of Truth

- **Root `.env.dev`**: master env file for local dev (`MOCK_AUTH=true`, `AWS_ENDPOINT_URL=http://localhost:4566`, bucket names, etc.)
- **Docker Compose**: `env_file: ../.env.dev` in `infrastructure/docker-compose.localstack.yml`

### 3.2 Subproject Usage

- **Vite/Frontend**: Vite auto-reads `.env` in project root. Use symlink if needed: `ln -s ../../.env.dev .env.local`
- **Vitest**: load root file in `vitest.setup.ts` via `dotenv.config({ path: '../../.env.dev' })`
- **SAM (opt3)**: `localstack-opt3.sh` generates `infrastructure/sam/env.json` from `.env.dev` at startup

### 3.3 Key Variables

| Variable | Where set | Purpose |
|----------|-----------|---------|
| `MOCK_AUTH=true` | `.env.dev` | Bypasses Cognito JWT validation in Lambda handlers |
| `AWS_ENDPOINT_URL` | `.env.dev` | Points AWS SDK to LocalStack (or ministack) |
| `TABLE_NAME_MAIN` | `.env.dev` + CDK | DynamoDB table name |
| `BUCKET_*_NAME` | `.env.dev` + CDK | S3 bucket names (5 buckets) |

---

## 4. System Review Protocol

When investigating cross-environment inconsistencies (e.g., "Why does CORS fail locally but not in prod?"):

### 4.1 Analysis Framework

1. **Trace the Entry Point** — identify where the request first hits the system (LocalStack Edge vs. CloudFront)
2. **Audit Config vs. Usage** — compare defined variables (e.g., `CORS_ALLOW_HEADERS`) against where they are applied (`accessControlAllowHeaders`)
3. **Check Error Passthroughs** — ensure 4xx/5xx responses include the same CORS/security headers as 2xx

### 4.2 Reporting Format

Create `notes/YYYY-MM-DD-<context>-review.md`:
- **Environment Delta**: differences between Local, Staging, Prod
- **Identified Risks**: specific configuration gaps
- **Optimization Strategies**: redundancy removal or streamlining

### 4.3 Example: Edge-First CORS

**Scenario:** Local API works, Prod returns `No 'Access-Control-Allow-Origin' header`.
**Root Cause:** CloudFront `ResponseHeadersPolicy` active but `accessControlAllowHeaders` is `[]`, blocking the `Authorization` header.
**Fix:** Synchronize `CORS_ALLOW_HEADERS` into both the API Gateway and the CloudFront policy.

---

## 5. Worktree Bootstrap

### 5.1 Prerequisites (one-time setup)

```bash
# 1. Copy the env template and fill in real values
cp env.shared.template .env.shared
# Edit .env.shared — set GITHUB_TOKEN, any real credentials

# 2. Verify the hook is executable
ls -la .claude/hooks/syslink-configs.sh
# Should show -rwxr-xr-x. If not: chmod +x .claude/hooks/syslink-configs.sh
```

### 5.2 Create a new worktree

Use Claude Code's worktree command (fires `WorktreeCreate` hook automatically):

```
/worktree create feature/<branch-name>
```

The hook (`syslink-configs.sh`) runs immediately after creation and:
- Symlinks `tsconfig.base.json` → root (shared, not copied)
- Generates `.env.dev` = `.env.shared` + auto-assigned ports (Vite: 3000–3009, SAM: 3010–3099)
- Logs: `[syslink-configs] Initialized worktree: VITE=3001 SAM=3012`

### 5.3 Start dev in the worktree

```bash
cd /path/to/worktree

# Option 3 (recommended): LocalStack data + SAM CLI + Vite
npm run dev:opt3

# Option 2: Full LocalStack + Vite
npm run dev:opt2
```

Each worktree gets its own ports — parallel worktrees never collide.

### 5.4 Env file anatomy

| File | Location | Tracked? | Purpose |
|------|----------|----------|---------|
| `env.shared.template` | root | ✅ git | Reference for filling in `.env.shared` |
| `.env.shared` | root | ❌ gitignored | Shared vars (AWS, tables, buckets) — source for hook |
| `worktree.env.template` | root | ✅ git | Documents worktree-local port ranges |
| `.env.dev` | each worktree | ❌ gitignored | Generated by hook = shared + local ports |
| `.env.local` | each worktree | ❌ gitignored | Personal overrides; copied verbatim by `.worktreeinclude` |
| `.cognito.env` | each worktree | ❌ gitignored | Cognito credentials; copied verbatim by `.worktreeinclude` |

### 5.5 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ln: .env.shared: No such file` | `.env.shared` missing | Copy `env.shared.template` → `.env.shared` |
| Port collision between worktrees | Hook not re-run after collision | Delete worktree `.env.dev` and re-run hook |
| `tsc: Cannot find tsconfig.base.json` | Symlink missing | Re-run hook or `ln -sf $(git rev-parse --show-toplevel)/tsconfig.base.json .` |
| Hook received no stdin / path is null | Created via raw `git worktree add` | Always create worktrees via `/worktree create` in Claude Code |

---

## 6. Parallel Agent Workflow

Running multiple Claude Code sessions simultaneously — one per domain worktree.

### 6.1 Branch naming convention

```
feat/<domain>/<slug>
```

The `<domain>` segment maps directly to an agent file:

| Domain | Agent file |
|--------|-----------|
| `contract` | `ai/agents/contract-agent.md` |
| `backend` | `ai/agents/backend-agent.md` |
| `infra` | `ai/agents/infra-agent.md` |
| `cicd` | `ai/agents/cicd-agent.md` |
| `frontend` | `ai/agents/frontend-agent.md` |
| `qa` | `ai/agents/qa-agent.md` |
| `localstack` | `ai/agents/localstack-agent.md` |

Example: `/worktree create feat/backend/fix-concurrency` → hook writes `backend-agent.md` content into `.agent.md` at the worktree root.

### 6.2 Session start ritual

After Claude Code opens in a worktree, prime the session with:

```
"Read .agent.md — that is your agent context for this worktree."
```

`.agent.md` contains: the full agent persona + absolute paths to all skill files.
It is auto-generated by the hook and gitignored — do not commit it.

### 6.3 Active worktrees and dependencies

`ai/WORKTREES.md` is the live map. Before opening a PR, update your row's status. Before starting a blocked worktree, check whether its dependency has merged.

### 6.4 Contract gate

AC-003 (Group response leaks DynamoDB keys) must merge before the backend and frontend worktrees proceed with group-related work. Check merge status:

```bash
git fetch origin && git log origin/main --oneline | grep -i "AC-003\|contract"
```

### 6.5 Cross-agent coordination rules

- **Shared types** (`shared/src/api/types.ts`) — any agent that needs to change this file must coordinate with contract-agent first. Add the dependency to `ai/WORKTREES.md`.
- **LocalStack** — shared singleton across all worktrees. The first agent to need it calls `docker compose up -d`. All others poll health before starting integration tests. Implementation: `ai/agents/localstack-agent.md §9`.
- **IaC-004 / DEP-001** — same root cause (missing `BUCKET_ASSETS_NAME` env var) from two angles. infra-agent lands the CDK injection; backend-agent verifies it in integration tests afterward. Do not merge backend before infra.

### 6.6 Planned merge order

1. `contract/fix-ac003` — gate
2. `cicd/fix-security` — independent
3. `infra/fix-iac` — independent
4. `backend/fix-critical` — after contract gate
5. `frontend/fix-critical` — after contract gate
6. `qa/fix-coverage` — after backend

### 6.7 Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `.agent.md` missing in worktree | Branch does not follow `feat/<domain>/<slug>` | Rename branch or manually copy the agent file |
| `.agent.md` has wrong agent content | Domain segment doesn't match an agent file | Check second path segment; rename branch |
| Port collision between parallel worktrees | Same port auto-assigned | Delete `.env.dev` in the newer worktree and re-run hook |
| Two sessions compete to start LocalStack | No coordination | Safe — first caller holds POSIX flock; second waits. See `localstack-agent.md §9` |
