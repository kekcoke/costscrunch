# Phase 2 — Important Issues

> **51 issues · 7 worktrees · rolling unblock from Phase 1**
> Open each worktree as its Phase 1 dependency merges — do not wait for all three Phase 1 PRs.

---

## Worktree Table

| Worktree | Branch | Agent | Issues | Status | Unblocks after |
|---|---|---|---|---|---|
| `p2/backend-perf` | `feat/p2/backend-perf` | backend-agent | CON-003, CON-004, PERF-003, PERF-004, SCALE-001, SCALE-002, SCALE-003 | blocked | `p1/backend-critical` |
| `p2/backend-safety` | `feat/p2/backend-safety` | backend-agent | SF-006, SF-007, SF-008, SF-009, SIMP-001, SIMP-002, OPS-001, DEP-003 | blocked | `p1/backend-critical` |
| `p2/types` | `feat/p2/types` | types-agent | TDA-001, TDA-002, TDA-003, TDA-004, TDA-005 | blocked | `p1/backend-critical` |
| `p2/infra` | `feat/p2/infra` | infra-agent | IaC-008–IaC-018 (11 issues) | blocked | `p1/infra-critical` |
| `p2/cicd` | `feat/p2/cicd` | cicd-agent | SEC-003, SEC-004, BUG-004–BUG-008, CONF-001, CONF-002 | blocked | `p1/cicd-critical` |
| `p2/frontend` | `feat/p2/frontend` | frontend-agent | FE-006–FE-014 | blocked | `p1/backend-critical` |
| `p2/qa` | `feat/p2/qa` | qa-agent | TEST-003, TEST-004 | blocked | `p2/backend-perf` + `p2/backend-safety` |

Primers: `ai/phases/primers/phase-2-primers.md`

---

## Phase 3 Rolling Unblock Gates

| Phase 3 Worktree | Unblocks when |
|---|---|
| `p3/backend-cleanup` | `p2/backend-perf` + `p2/backend-safety` both merge |
| `p3/infra-cleanup` | `p2/infra` merges |
| `p3/cicd-cleanup` | `p2/cicd` merges |
| `p3/frontend-cleanup` | `p2/frontend` merges |

---

## Worktree Lifecycle

### Verify Unblock Before Creating

```bash
# Before opening a Phase 2 worktree, confirm its Phase 1 dependency merged:
git fetch origin
git log origin/main --oneline | grep -i "p1/backend-critical\|PERF-002\|SF-002\|SF-004\|SF-005"
# Repeat with the relevant Phase 1 branch/issue IDs for infra and cicd
```

### Create

```bash
# Manual creation (Claude Code WorktreeCreate/EnterWorktree is preferred):
git fetch origin

git worktree add -b feat/p2/backend-perf    ../costscrunch-p2-backend-perf    main
git worktree add -b feat/p2/backend-safety  ../costscrunch-p2-backend-safety  main
git worktree add -b feat/p2/types           ../costscrunch-p2-types           main
git worktree add -b feat/p2/infra           ../costscrunch-p2-infra           main
git worktree add -b feat/p2/cicd            ../costscrunch-p2-cicd            main
git worktree add -b feat/p2/frontend        ../costscrunch-p2-frontend        main
# p2/qa opens only after p2/backend-perf and p2/backend-safety both merge:
git worktree add -b feat/p2/qa             ../costscrunch-p2-qa              main
```

### Open a Session

```bash
# First action in every agent session (inside the worktree directory):
# 1. Read .agent.md                                  ← injected by WorktreeCreate hook
# 2. Read ai/phases/primers/phase-2-primers.md       ← find your section by branch name
# 3. Start with the first issue in fix order
```

### During Work

```
- Fix one issue at a time, in the order listed in your primer.
- After each fix: run your domain test gate, then call /commit-fix <ISSUE-ID>.
- Update your row in ai/WORKTREES.md after each commit.
- Never git push — flag the human to push when all your issues are committed.
```

### Close (After PR Merges)

```bash
# Run from the main repo root, NOT from inside the worktree:

git worktree remove ../costscrunch-p2-backend-perf   # repeat for each
git branch -d feat/p2/backend-perf

# Then in ai/WORKTREES.md:
# - Update row status to 'merged'
# - Check the Phase 3 rolling unblock table above
```

---

## Best Practices

- Never commit `.env*`, `cdk.out/`, or `node_modules/` from the worktree.
- **Backend**: unit test gate is `cd backend && npm run test:ut`. Add `npm run test:ig` for CON-003, CON-004, SCALE-001, SCALE-002, SCALE-003, SF-006 (require LocalStack).
- **Types**: `cd backend && npx tsc --noEmit` must pass before any types commit; then run `npm run test:ut`.
- **Infra**: `cd infrastructure && npm run synth` must pass before every CDK commit. For IaC-008/009/017, also run `cd infrastructure && npm test` if LocalStack is available.
- **CI/CD**: YAML lint all three workflow files after every edit.
- **Frontend**: `cd frontend && npx vitest run` after each fix; run dev server for visual checks on FE-006, FE-007, FE-013, FE-014.
- **QA**: `cd backend && npm run test:ut` for TEST-003; `npm run test:ig` for TEST-004 (LocalStack required).
- LocalStack singleton: POSIX flock guard from `ai/skills/SKILLS.md §9` — never `docker compose up -d` directly.
- Coverage must not regress: 75% backend functions/lines, 70% branches; 70% frontend.

---

## Cross-Worktree Coordination Notes

- **DEP-003 / IaC-011**: Same root cause (WEBSOCKET_ENDPOINT missing from imagePreprocessLambda). backend-safety fixes the backend env read; infra fixes the CDK injection (IaC-011). Coordinate so neither regresses the other. Open infra's IaC-011 first if possible.
- **TDA-002 / backend handlers**: `withErrorHandler` becoming generic (TDA-002) may require minor type annotation updates across handler files. types-agent should not modify handler logic — only the wrapper signature.
- **SCALE-003 SK prefix change**: changing GROUP_MEMBER# SK prefix is a DynamoDB schema migration. Flag the human before committing — this requires a data migration for existing items if staging DB has real data.
- **CONF-001**: consolidating the two CI pipelines is a large structural change. cicd-agent should do a thorough read of both files before touching CONF-001. Do it last, after all other cicd issues are committed.
