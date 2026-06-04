# commit-fix — Per-Issue Commit Skill

## When to Use

Call `/commit-fix <ISSUE-ID>` immediately after completing and verifying a single issue fix. One call per issue, before moving on to the next. Never batch multiple issues into one call.

---

## How It Works

1. **Run the domain test gate** (see table below). All tests must pass. Do not skip.
2. **Stage only fix-related files.** List each file explicitly — never `git add -A` or `git add .`.
3. **Create the commit** with the conventional message format.
4. **Update `ai/WORKTREES.md`** — increment the completed count in your row.
5. If this is the last issue in your worktree: flag the human to push and open a PR. Update row status to `pr open`.

---

## Domain Test Commands

| Domain | Unit / Compile gate | Integration gate (LocalStack required) |
|--------|---------------------|----------------------------------------|
| backend | `cd backend && npm run test:ut` | `cd backend && npm run test:ig` (for CON/SCALE/SF issues only) |
| frontend | `cd frontend && npx vitest run` | — |
| infra | `cd infrastructure && npm run synth` | `cd infrastructure && npm test` (for networking/SG changes only) |
| cicd | `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/workflow.yml'))" && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rollback.yml'))"` | — |
| types | `cd backend && npx tsc --noEmit` then `cd backend && npm run test:ut` | — |
| qa | `cd backend && npm run test:ut` (unit) or `npm run test:ig` (integration) | — |

---

## Commit Format

```
fix(<domain>): <ISSUE-ID> <one-line description>

[Optional: one sentence explaining the why if non-obvious]
```

Examples:
```
fix(backend): PERF-002 replace ScanCommand fallback with QueryCommand in GET/PATCH expenses/{id}
fix(infra): IaC-007 set numCacheClusters to 2 in prod to satisfy automaticFailoverEnabled
fix(cicd): BUG-003 implement manual rollback with OIDC credentials and cloudformation wait
fix(types): TDA-002 make withErrorHandler generic to restore compile-time handler type safety
```

Co-author line is required on all commits:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Full commit command template:
```bash
git commit -m "$(cat <<'EOF'
fix(<domain>): <ISSUE-ID> <description>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Override Rules

If tests cannot run due to an external blocker (LocalStack unavailable, CDK synth requires live AWS credentials, CI environment only), you may skip the integration gate **only**. The unit / compile gate is never skippable.

When overriding, add a note in the commit message body:
```
fix(backend): SCALE-002 replace 1+N analytics with BatchGetItem

Integration test skipped — LocalStack not available in this session.
Verify with: cd backend && npm run test:ig

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Record the override in `ai/WORKTREES.md` under your row as a sub-note so the human reviewer knows to run `npm run test:ig` before merging.

---

## WORKTREES.md Update

After each commit, update your row in `ai/WORKTREES.md`:
- Increment issues count if tracking completed vs total (e.g., `3/7 done`)
- Change status from `in progress` → `pr open` after your final commit and the human pushes

---

## Security Rules

- Never commit `.env*`, `*.pem`, secrets, or credentials.
- Never commit `cdk.out/`, `node_modules/`, or build artifacts.
- Stage files by name, not by glob — `git add backend/src/lambdas/expenses/index.ts`, not `git add backend/`.
