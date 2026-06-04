# Phase 1 — Critical Issues

> **8 issues · 3 worktrees · all parallel**
> These are production blockers or severe security/correctness failures. Open all three worktrees immediately — they have no cross-domain dependencies.

---

## Worktree Table

| Worktree | Branch | Agent | Issues | Status |
|---|---|---|---|---|
| `p1/backend-critical` | `feat/p1/backend-critical` | backend-agent | PERF-002, SF-002, SF-004, SF-005 | ready |
| `p1/infra-critical` | `feat/p1/infra-critical` | infra-agent | IaC-007 | ready |
| `p1/cicd-critical` | `feat/p1/cicd-critical` | cicd-agent | BUG-001, BUG-002, BUG-003 | ready |

Primers: `ai/phases/primers/phase-1-primers.md`

---

## Phase 2 Rolling Unblock Gates

Phase 2 worktrees open as their Phase 1 dependency merges — they do not wait for all three Phase 1 PRs:

| Phase 2 Worktree | Unblocks when |
|---|---|
| `p2/backend-perf` | `p1/backend-critical` merges |
| `p2/backend-safety` | `p1/backend-critical` merges |
| `p2/types` | `p1/backend-critical` merges |
| `p2/frontend` | `p1/backend-critical` merges |
| `p2/infra` | `p1/infra-critical` merges |
| `p2/cicd` | `p1/cicd-critical` merges |
| `p2/qa` | `p2/backend-perf` + `p2/backend-safety` both merge |

---

## Worktree Lifecycle

### Create

```bash
# Preferred — Claude Code's WorktreeCreate/EnterWorktree tool triggers .agent.md injection.
# Manual fallback:

git fetch origin

git worktree add -b feat/p1/backend-critical ../costscrunch-p1-backend main
git worktree add -b feat/p1/infra-critical   ../costscrunch-p1-infra   main
git worktree add -b feat/p1/cicd-critical    ../costscrunch-p1-cicd    main
```

### Open a Session

```bash
# First action in every agent session (inside the worktree directory):
# 1. Read .agent.md                                  ← injected by WorktreeCreate hook
# 2. Read ai/phases/primers/phase-1-primers.md       ← find your section by branch name
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

git worktree remove ../costscrunch-p1-backend  # repeat for each
git branch -d feat/p1/backend-critical

# Then in ai/WORKTREES.md:
# - Update row status to 'merged'
# - Check the Phase 2 rolling unblock table above — open any newly unblocked worktrees
```

---

## Best Practices

- Never commit `.env*`, `cdk.out/`, or `node_modules/` from the worktree.
- `node_modules/` is shared via symlinks — only run `npm install` if `package.json` changed.
- **Backend**: `npm run test:ut` after every fix; `npm run test:ig` when LocalStack is up for SF issues.
- **Infra**: `cd infrastructure && npm run synth` must pass before every commit.
- **CI/CD**: YAML lint all three workflow files after every change.
- LocalStack singleton: use the POSIX flock guard from `ai/skills/SKILLS.md §9` — never call `docker compose up -d` directly.
- Coverage must not regress: 75% backend functions/lines, 70% branches; 70% frontend.
