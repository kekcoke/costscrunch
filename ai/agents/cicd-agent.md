# CostsCrunch — cicd-agent.md
## GitHub Actions / Deployment Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> For a critical fix: follow `ai/skills/fix-critical.md` then return here for domain context.

---

## 1. Role

You are the CI/CD domain expert for CostsCrunch. Your responsibilities:
- Harden GitHub Actions workflows against supply chain attacks (action pinning)
- Migrate CI/CD from static AWS keys to OIDC federation
- Fix broken rollback logic and deployment reliability issues
- Enforce concurrency controls to prevent simultaneous deploys
- Never trigger a live deploy — all deploy verification requires human approval and a push

Your domain: `.github/workflows/`, `infrastructure/stacks/GitHubActionsStack.ts`

**Critical autonomy note:** You can edit workflow YAML files and commit them, but you cannot push to the remote. Flag the human to push and monitor the first GitHub Actions run after your changes.

---

## 2. Domain File Map

### Workflow files
| File | Trigger | Purpose |
|------|---------|---------|
| `.github/workflows/workflow.yml` | push / PR to main, staging | CI: quality gate (lint, type-check, test), security scan (Semgrep, npm audit, Gitleaks), build (Lambda bundle, frontend, CDK synth), artifact upload |
| `.github/workflows/deploy.yml` | CI success (workflow_run) or manual dispatch | CD: staging deploy → E2E (Playwright) → prod deploy with manual approval gate |
| `.github/workflows/rollback.yml` | Manual trigger only | Post-deploy health check + CloudFormation rollback on failure |

### Infrastructure (OIDC role)
| File | Purpose |
|------|---------|
| `infrastructure/stacks/GitHubActionsStack.ts` | CDK stack that creates IAM roles for GitHub OIDC federation |

### GitHub configuration
| Setting | Location |
|---------|---------|
| Repository variables | `vars.DEV_GITHUB_ROLE_ARN`, `vars.STAGING_GITHUB_ROLE_ARN`, `vars.PROD_GITHUB_ROLE_ARN` |
| Repository secrets | See README.md "Required GitHub Secrets" table |
| Environment protection | `staging`: no approval; `production`: 1+ reviewer required |

---

## 3. Active Audit Findings

Source file: `notes/2026-05-30-github-actions-audit.md`

### SEC-001 — All Third-Party Actions Unpinned (SECURITY CRITICAL)
**Problem:** Every `uses:` in the three workflow files references a mutable tag (e.g., `actions/checkout@v4`) instead of an immutable commit SHA. A compromised action tag could inject malicious code into the CI pipeline (supply chain attack).
**Fix:** Pin every third-party action to its full commit SHA. Use a comment to retain the human-readable version:

```yaml
# BEFORE (vulnerable)
- uses: actions/checkout@v4
- uses: aws-actions/configure-aws-credentials@v4

# AFTER (pinned)
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
- uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502  # v4.0.2
```

**How to find the SHA for a tag:**
```bash
# For a GitHub action, the SHA is the commit the tag points to
gh api repos/actions/checkout/git/refs/tags/v4 --jq '.object.sha'
```

Actions to pin (check all three workflow files):
- `actions/checkout`
- `actions/setup-node`
- `actions/upload-artifact`
- `actions/download-artifact`
- `aws-actions/configure-aws-credentials`
- `aws-actions/amazon-ecr-login` (if present)
- `hashicorp/setup-terraform` (if present)
- Any Semgrep, Gitleaks, or other security scanner actions

Update `ai/references/REFERENCES.md` with the pinned SHAs for documentation.

### SEC-002 — Static AWS Keys Instead of OIDC (SECURITY CRITICAL)
**Problem:** The CI workflow uses `AWS_ACCESS_KEY_ID_DEV` and `AWS_SECRET_ACCESS_KEY_DEV` secrets — long-lived static credentials. The `GitHubActionsStack.ts` already defines the OIDC IAM role, but the workflow never uses it.
**Fix in `workflow.yml`** (for CDK synth step):
```yaml
permissions:
  id-token: write
  contents: read

- name: Configure AWS credentials (OIDC)
  uses: aws-actions/configure-aws-credentials@<SHA>
  with:
    role-to-assume: ${{ vars.DEV_GITHUB_ROLE_ARN }}
    aws-region: us-east-1
```
Remove references to `AWS_ACCESS_KEY_ID_DEV` and `AWS_SECRET_ACCESS_KEY_DEV` once OIDC is confirmed working.

**Fix in `deploy.yml`** (for staging/prod deploy steps):
```yaml
permissions:
  id-token: write
  contents: read

- name: Configure AWS credentials for staging
  uses: aws-actions/configure-aws-credentials@<SHA>
  with:
    role-to-assume: ${{ vars.STAGING_GITHUB_ROLE_ARN }}
    aws-region: us-east-1
```

### BUG-001 — Rollback Workflow Has No AWS Credentials (DEPLOY SAFETY)
**Problem:** The `rollback.yml` workflow calls `aws cloudformation rollback-stack` but has no step to configure AWS credentials. The AWS CLI call silently fails (no credentials available) — rollback never actually executes.
**Fix in `rollback.yml`:** Add OIDC credential configuration before the CloudFormation step:
```yaml
jobs:
  rollback:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@<SHA>
        with:
          role-to-assume: ${{ vars.PROD_GITHUB_ROLE_ARN }}
          aws-region: us-east-1

      - name: Rollback CloudFormation stack
        run: |
          aws cloudformation rollback-stack \
            --stack-name costscrunch-prod-CostsCrunchStack
```

### BUG-002 — Rollback Health Check Exits Non-Zero (DEPLOY SAFETY)
**Problem:** The health check script in the rollback workflow exits with a non-zero code on failure, causing the `if: always()` rollback step to be skipped (GitHub Actions skips steps if a required prior step failed, unless the step itself has `if: always()`).
**Fix:** Add `if: always()` to the rollback execution step — it must run even when the health check fails:
```yaml
- name: Execute rollback
  if: always()   # Run even if health check step failed
  run: |
    aws cloudformation rollback-stack --stack-name costscrunch-prod-CostsCrunchStack
```
Also ensure the health check script itself uses `|| true` or a specific exit code that the workflow can interpret as "failed health check, trigger rollback" vs "fatal script error."

### CON-CI-001 — Concurrent Deploys Not Prevented (HIGH)
**Problem:** Nothing prevents two simultaneous runs of the deploy workflow (e.g., two PRs merged in quick succession). Concurrent CDK deploys to the same stack cause a CloudFormation `UPDATE_IN_PROGRESS` conflict.
**Fix in `deploy.yml`:**
```yaml
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false   # Never cancel an in-progress deploy — queue it
```

---

## 4. OIDC Setup Reference

The `GitHubActionsStack.ts` CDK stack creates the IAM roles. Once deployed:

1. `GitHubActionsStack` outputs the role ARNs
2. Set them as GitHub repository variables:
   - `vars.DEV_GITHUB_ROLE_ARN` = `arn:aws:iam::<account>:role/costscrunch-dev-github-actions-role`
   - `vars.STAGING_GITHUB_ROLE_ARN` = `arn:aws:iam::<account>:role/costscrunch-staging-github-actions-role`
   - `vars.PROD_GITHUB_ROLE_ARN` = `arn:aws:iam::<account>:role/costscrunch-prod-github-actions-role`
3. Remove static key secrets (`AWS_ACCESS_KEY_ID_DEV`, `AWS_SECRET_ACCESS_KEY_DEV`) after OIDC is confirmed

---

## 5. Operating Procedure (Autonomous)

1. **Read** the audit finding in `notes/2026-05-30-github-actions-audit.md`
2. **Read** the affected workflow file(s)
3. **Apply** the fix
4. **Validate YAML syntax:**
```bash
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "YAML OK"
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/workflow.yml'))" && echo "YAML OK"
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/rollback.yml'))" && echo "YAML OK"
```
5. **Commit:** `git commit -m "chore: <description> (resolves <audit-id>)"`
6. **Flag for human:** "Push branch `fix/cicd/<audit-id>` and monitor the first GitHub Actions run. I cannot push or observe Actions runs."

---

## 6. Verification

```bash
# YAML lint (local)
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo "OK"

# After push (human must execute):
gh run list --workflow deploy.yml --limit 5
gh run view <run-id>
```

**Manual verification checklist after pushing:**
- [ ] Workflow triggers on PR to main
- [ ] OIDC credential step succeeds (no "Unable to assume role" error)
- [ ] CDK synth step succeeds
- [ ] Pinned action SHAs resolve (no "Could not find action" errors)
- [ ] Concurrent deploy test: trigger two simultaneous runs, confirm second queues not cancels

---

## 7. Environment Protection Rules

| Environment | Approval | Deployment Branch | Auto-deploy |
|-------------|----------|-------------------|-------------|
| staging | None | main, staging | Yes (on CI success) |
| production | 1+ reviewer | main only | Yes (after staging E2E passes) |

Never bypass environment protection rules — they are the human gate for production deploys.
