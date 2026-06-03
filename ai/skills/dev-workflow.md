# CostsCrunch — dev-workflow.md
## Agent Execution Protocol

> Autonomy rules (what agents may/must not do): `ai/system/system-prompt.md §5`
> For triaging a specific audit finding: `ai/skills/fix-critical.md`

---

## 1. Branch

```bash
git checkout main
git checkout -b fix/<domain>/<audit-id>
# e.g. fix/backend/CON-001   fix/infra/IaC-003   feat/frontend/ws-reconnect
```

Domain abbreviations: `backend` · `frontend` · `infra` · `cicd` · `qa` · `localstack`

---

## 2. Read Before Writing

Always read in this order before touching any file:
1. The audit finding in the relevant `notes/2026-05-30-*.md`
2. The affected source file(s)
3. The existing tests for those files

Never edit from memory.

---

## 3. Apply a Minimal Fix

- Fix ONLY the root cause. No refactoring, no feature additions, no scope creep.
- If the fix requires a coordinated change in another domain, stop at your domain boundary and leave a handoff note (see §6 below). Do not attempt to fix both domains in one branch unless trivially coupled.

---

## 4. Domain Test Gate (before every commit)

Run the test command for your domain. **Do not commit if any test is red.**

| Domain | Command |
|--------|---------|
| Backend | `cd backend && npm run test:ut` |
| Frontend | `cd frontend && npx vitest run` |
| Infrastructure | `cd infrastructure && npm run synth && npm test` |
| CI/CD | YAML lint: `python3 -c "import yaml; yaml.safe_load(open('<file>'))"` |
| QA (integration) | `cd backend && npm run test:ig` (requires LocalStack) |
| LocalStack | `cd infrastructure && npm test` (requires LocalStack) |

Do not use `.skip`, `.only`, or `// @ts-ignore` to make tests pass. Fix the root cause.

---

## 5. Commit

```bash
git add <specific files — never git add -A without reviewing>
git commit -m "fix: <one-line description> (resolves <audit-id>)"
```

**Prefix guide:**
```
fix:   bug fix
feat:  new feature
test:  test additions/updates
infra: CDK/IaC changes
chore: workflow, config, tooling changes
```

Full commit format rules: `ai/system/system-prompt.md §5`

---

## 6. Cross-Domain Handoff

When a fix has a dependency in another domain, leave a handoff note as the commit body or in a `notes/` file:

```
HANDOFF to <agent>:
- This branch resolves <audit-id> on the <domain> side.
- Complementary change needed: <description>
- Files to edit: <paths>
- Verify with: <test command>
```

Common dependencies (from audit):

| Fix | Primary agent | Depends on |
|-----|--------------|-----------|
| IaC-004 (BUCKET_ASSETS_NAME) | infra-agent | backend-agent confirms the Lambda reads the var |
| CON-001 (TOCTOU fix) | backend-agent | qa-agent adds concurrency test |
| CON-002 (settlement atomicity) | backend-agent | qa-agent adds atomicity test |
| FE-005 (ScanModal real API) | frontend-agent | backend-agent confirms receipts Lambda is working |

---

## 7. Document

After every merged fix:
1. Add an entry to `changelog/YYYY-MM-DD.md` (one line per fix)
2. If the bug was subtle or the root cause surprising, add a bullet to `ai/skills/SKILLS.md §2 Common Pitfalls`
3. For complex debugging sessions, create `notes/YYYY-MM-DD-<context>-tb.md`
