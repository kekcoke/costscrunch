# Phase 1 Primers — Critical Issues
> Copy-paste the relevant section when opening a Phase 1 worktree session.
> Each primer assumes `.agent.md` has been injected by the WorktreeCreate hook.

---

## backend-agent · `feat/p1/backend-critical`

```
You are the backend-agent for this worktree (feat/p1/backend-critical).

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/lambdas/expenses/index.ts — PERF-002, SF-004, SF-005 live here
3. backend/src/lambdas/receipts/index.ts — SF-002 lives here
4. backend/__tests__/unit/expenses.unit.test.ts — existing mock patterns

Skill available in this session: /commit-fix <ISSUE-ID>
Call it after each fix passes the unit test gate. Never batch issues.
Test gate: cd backend && npm run test:ut

Your 4 issues, in fix order:

SF-004 (CRITICAL) — expenses/index.ts:119–126, sendCommand wrapper
  sendCommand catches every DynamoDB exception and returns undefined.
  Throttling, IAM denials, and network failures all surface as 404 "Expense not found".
  Fix: delete the sendCommand helper entirely. Replace every call site with a direct
  ddb.send(...) call. Let exceptions propagate — withErrorHandler and the Lambda runtime
  surface the real error. Search for all sendCommand call sites before deleting.
  After fix: npm run test:ut — confirm no tests mock sendCommand (update mocks if needed).
  Then: /commit-fix SF-004

SF-005 (CRITICAL) — expenses/index.ts, DELETE /expenses/{id} handler
  ConditionalCheckFailedException is caught and returns 200 { deleted: true }.
  An authorization failure (wrong owner) is presented as success.
  Fix: in the catch block, distinguish two cases:
    - Item exists but wrong owner → 403 "Not authorized to delete this expense"
    - Item absent (already deleted) → 404 "Expense not found"
  Use a GetCommand before the delete to determine which case applies, or read the
  ConditionalCheckFailedException reason field if available.
  After fix: npm run test:ut
  Then: /commit-fix SF-005

SF-002 (CRITICAL) — receipts/index.ts:293–310, Textract failure path
  StartExpenseAnalysisCommand throw leaves the scan record stuck in "processing" forever.
  The try/finally closes the tracing subsegment but lets the error propagate without
  writing a terminal status.
  Fix: convert try/finally to try/catch/finally. In the catch block, write status: "failed"
  to the scan record in DynamoDB before re-throwing. The finally block still handles
  tracing cleanup.
  After fix: npm run test:ut
  Then: /commit-fix SF-002

PERF-002 (CRITICAL) — expenses/index.ts:335,402
  GET /expenses/{id} and PATCH /expenses/{id} fall back to a full table ScanCommand
  with FilterExpression when the direct GetCommand/QueryCommand miss. O(N) cost and
  latency; throttling errors surface as "Expense not found".
  Fix: remove the scan fallback entirely. The pk must be derivable from context:
  - Personal expenses: pk = USER#<userId> (from getAuth(event).userId)
  - Group expenses: pk = GROUP#<groupId> (from path parameter or request body)
  If the groupId is not in the request context for PATCH, require it as a body/query field.
  Always use QueryCommand or GetCommand with the correct pk.
  After fix: npm run test:ut
  Then: /commit-fix PERF-002

After all 4 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(backend): PERF-002 SF-002 SF-004 SF-005 — eliminate scan fallback and fix error masking
Update ai/WORKTREES.md row p1/backend-critical → status: pr open
```

---

## infra-agent · `feat/p1/infra-critical`

```
You are the infra-agent for this worktree (feat/p1/infra-critical).

Start by reading these files:
1. .agent.md — your full domain context
2. infrastructure/stacks/CostsCrunchStack.ts — IaC-007 is at lines 386–398

Skill available in this session: /commit-fix <ISSUE-ID>
Call it after the fix passes the synth gate. Never batch issues.
Test gate: cd infrastructure && npm run synth

Your 1 issue:

IaC-007 (CRITICAL) — CostsCrunchStack.ts:386–398
  automaticFailoverEnabled: isProd is set with numCacheClusters: 1.
  CloudFormation validation rejects this combination in prod:
  "InvalidParameterCombination: fewer than 2 cache nodes required for multi-AZ".
  The first prod deploy will abort mid-stack.
  Fix: change numCacheClusters: 1 to numCacheClusters: isProd ? 2 : 1.
  CDK rule: after every change, cd infrastructure && npm run synth must pass.
  Then: /commit-fix IaC-007

After the fix is committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(infra): IaC-007 set numCacheClusters to 2 in prod for automaticFailoverEnabled
Update ai/WORKTREES.md row p1/infra-critical → status: pr open
```

---

## cicd-agent · `feat/p1/cicd-critical`

```
You are the cicd-agent for this worktree (feat/p1/cicd-critical).

Start by reading these files:
1. .agent.md — your full domain context
2. .github/workflows/rollback.yml — BUG-001, BUG-002 live here
3. .github/workflows/deploy.yml — BUG-003 lives here (lines 208–218)

Skill available in this session: /commit-fix <ISSUE-ID>
Call it after each fix passes the YAML lint gate. Never batch issues.
Test gate (run after every edit, all three files):
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/workflow.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rollback.yml'))" && echo OK

IMPORTANT: You can edit and commit workflow YAML. You cannot push to the remote.
After committing, flag the human to push and monitor the first GitHub Actions run.

Your 3 issues, in fix order:

BUG-001 (CRITICAL) — rollback.yml:74–104, missing AWS credentials in rollback job
  The health-check-and-rollback job calls aws cloudformation rollback-stack but has
  no AWS credential configuration. Every call fails with "Unable to locate credentials".
  Rollback has never worked in production.
  Fix: add OIDC credential configuration as the first two steps of the job:
    - uses: actions/checkout@<existing-SHA-from-file>
    - uses: aws-actions/configure-aws-credentials@<existing-SHA-from-file>
      with:
        role-to-assume: ${{ vars.PROD_GITHUB_ROLE_ARN }}
        aws-region: us-east-1
  Use the same action SHAs already present elsewhere in rollback.yml (they were pinned
  in PR #64). Add permissions: { id-token: write, contents: read } to the job if missing.
  YAML lint after editing.
  Then: /commit-fix BUG-001

BUG-002 (CRITICAL) — rollback.yml:42–72, health check exit 1 skips rollback step
  The health check step calls exit 1 on failure, which skips all subsequent steps
  (GitHub Actions behaviour). The rollback step and notifications never run.
  Fix:
  1. Remove exit 1 from the health check step.
  2. Add an output to the health check step: echo "passed=false" >> $GITHUB_OUTPUT
     (or echo "passed=true" on success).
  3. Add if: always() to the rollback execution step.
  4. Gate the rollback step: if: always() && steps.health_check.outputs.passed == 'false'
  5. Add a final step that re-fails the job:
       - name: Fail job if health check failed
         if: always() && steps.health_check.outputs.passed == 'false'
         run: exit 1
  YAML lint after editing.
  Then: /commit-fix BUG-002

BUG-003 (CRITICAL) — deploy.yml:208–218, manual rollback is a stub
  The manual dispatch rollback job body is:
    echo "Rolling back..."
    # implement with actual commands
  Operators triggering it during a prod incident get a green checkmark and no rollback.
  Fix: implement the rollback job with:
  1. actions/checkout step (with same SHA as elsewhere in deploy.yml)
  2. aws-actions/configure-aws-credentials with role: ${{ vars.PROD_GITHUB_ROLE_ARN }}
  3. aws cloudformation rollback-stack --stack-name costscrunch-prod
  4. aws cloudformation wait stack-rollback-complete --stack-name costscrunch-prod
  5. Slack notification step (use same pattern as other notification steps in deploy.yml)
  Add permissions: { id-token: write, contents: read } to the job if missing.
  YAML lint after editing.
  Then: /commit-fix BUG-003

After all 3 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(cicd): BUG-001 BUG-002 BUG-003 — fix rollback credentials, health gate, and stub
Update ai/WORKTREES.md row p1/cicd-critical → status: pr open
After the human confirms the first GitHub Actions run is green, update status → merged.
```
