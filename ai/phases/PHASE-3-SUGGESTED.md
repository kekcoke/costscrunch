# Phase 3 — High-Value Suggested Items

> **21 issues · 4 worktrees · rolling unblock from Phase 2**
> All low-risk cleanup. No hard gates between worktrees — open each as its Phase 2 dependency merges.

---

## Worktree Table

| Worktree | Branch | Agent | Issues | Status | Unblocks after |
|---|---|---|---|---|---|
| `p3/backend-cleanup` | `feat/p3/backend-cleanup` | backend-agent | SUG-001–006 (backend), deploy SUG-004 | blocked | `p2/backend-perf` + `p2/backend-safety` |
| `p3/infra-cleanup` | `feat/p3/infra-cleanup` | infra-agent | IaC-019, IaC-020, IaC-021, IaC-022, IaC-024 | blocked | `p2/infra` |
| `p3/cicd-cleanup` | `feat/p3/cicd-cleanup` | cicd-agent | cicd-SUG-001, SUG-002, SUG-005, SUG-007 | blocked | `p2/cicd` |
| `p3/frontend-cleanup` | `feat/p3/frontend-cleanup` | frontend-agent | FE-015, FE-016, FE-018, FE-020, FE-022 | blocked | `p2/frontend` |

Primers: `ai/phases/primers/phase-3-primers.md`

---

## Worktree Lifecycle

### Verify Unblock Before Creating

```bash
# Before opening a Phase 3 worktree, confirm its Phase 2 dependency merged:
git fetch origin
git log origin/main --oneline | grep -i "p2/backend-perf\|CON-003\|SCALE-001"
# Repeat with relevant Phase 2 branch/issue IDs for infra, cicd, frontend
```

### Create

```bash
git fetch origin

git worktree add -b feat/p3/backend-cleanup   ../costscrunch-p3-backend   main
git worktree add -b feat/p3/infra-cleanup     ../costscrunch-p3-infra     main
git worktree add -b feat/p3/cicd-cleanup      ../costscrunch-p3-cicd      main
git worktree add -b feat/p3/frontend-cleanup  ../costscrunch-p3-frontend  main
```

### Open a Session

```bash
# First action in every agent session:
# 1. Read .agent.md
# 2. Read ai/phases/primers/phase-3-primers.md — find your section
# 3. Start with the first issue in fix order
```

### During Work

```
- Fix one issue at a time.
- After each fix: run domain test gate → /commit-fix <ISSUE-ID>.
- Update ai/WORKTREES.md after each commit.
- Never git push — flag the human.
```

### Close (After PR Merges)

```bash
git worktree remove ../costscrunch-p3-backend  # repeat for each
git branch -d feat/p3/backend-cleanup
# Update ai/WORKTREES.md row → 'merged'
```

---

## Best Practices

- Phase 3 is cleanup — no behaviour changes without an explicit issue description requiring it.
- Backend: unit test gate is `cd backend && npm run test:ut`. TypeScript compile: `npx tsc --noEmit`.
- Infra: `cd infrastructure && npm run synth` before every commit.
- CI/CD: YAML lint all three workflow files. For CODEOWNERS, no test exists — verify path pattern syntax manually.
- Frontend: `cd frontend && npx vitest run`. No visual check required for Phase 3 items.
- Coverage must not regress.
