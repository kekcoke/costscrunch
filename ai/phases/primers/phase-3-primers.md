# Phase 3 Primers — High-Value Suggested Items
> Copy-paste the relevant section when opening a Phase 3 worktree session.

---

## backend-agent · `feat/p3/backend-cleanup`

```
You are the backend-agent for this worktree (feat/p3/backend-cleanup).
Verify before starting:
  git fetch origin
  git log origin/main --oneline | grep -i "CON-003\|CON-004\|SF-006\|SF-007"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/lambdas/ — scan for ok/err helper definitions (SUG-001)
3. backend/src/lambdas/expense-export/index.ts — SUG-002, SUG-006
4. backend/src/lambdas/expenses/index.ts — SUG-002, SUG-006
5. backend/src/lambdas/web-socket-notifier/index.ts — SUG-003
6. backend/src/lambdas/auth-trigger/post-confirmation.ts:57 — SUG-004
7. backend/src/lambdas/groups/index.ts — SUG-005
8. backend/src/utils/circuitBreaker.ts — deploy SUG-004

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd backend && npm run test:ut (and npx tsc --noEmit for shared util moves)

Your 7 issues, in fix order:

SUG-001 (backend) — ok/err helpers redefined in multiple Lambda files
  The ok() and err() response helpers are independently defined in ~6 Lambda files.
  Fix: create backend/src/utils/responses.ts with the canonical implementations.
  Update each Lambda to import from @helpers/responses (or the correct path alias).
  Run npx tsc --noEmit after each Lambda update to catch import errors.
  npm run test:ut → /commit-fix SUG-001

SUG-002 (backend) — stripInternal / CSV_COLUMNS duplicated
  stripInternal and CSV_COLUMNS are defined in both expense-export/index.ts and
  expenses/index.ts.
  Fix: create backend/src/utils/exportUtils.ts with the canonical definitions.
  Update both Lambda files to import from @helpers/exportUtils.
  npx tsc --noEmit && npm run test:ut → /commit-fix SUG-002

SUG-003 (backend) — pushToUsers logic duplicated (if not already done by p2/backend-perf CON-004)
  Check if CON-004 from p2/backend-perf already extracted the pushToUsers helper.
  If yes, skip this issue and note it in the WORKTREES.md row.
  If not: extract the shared Promise.allSettled fan-out block into pushToUsers in
  web-socket-notifier/index.ts. Both handlers call it identically.
  npm run test:ut → /commit-fix SUG-003 (or skip with note)

SUG-005 (backend) — normalizeRoute uses 50 lines of segment arithmetic
  The normalizeRoute (or equivalent routing logic) in groups/index.ts is overly complex.
  Fix: replace segment arithmetic with a routeKey match table:
    const ROUTES: Record<string, (params: RouteParams) => RouteHandler> = {
      'GET /groups':             handleGetGroups,
      'GET /groups/{id}':        handleGetGroup,
      ...
    }
  Use the existing routeKey directly from the event. Remove the segment-splitting logic.
  npx tsc --noEmit && npm run test:ut → /commit-fix SUG-005

SUG-006 (backend) — export handler duplicated in expenses/index.ts
  The full export pipeline exists in expense-export/index.ts. There is a duplicate
  export handler in expenses/index.ts that should be removed.
  Fix: identify the export handler in expenses/index.ts and remove it.
  Ensure GET /expenses/export is routed to expenseExportLambda only (already done by
  IaC-001 in Phase 0 PR #62 — verify the CDK routing is correct).
  npm run test:ut → /commit-fix SUG-006

SUG-004 (backend) — misleading Cognito retry comment
  auth-trigger/post-confirmation.ts:57 has a comment "// Let Cognito retry" that is
  factually incorrect (Cognito does not retry post-confirmation triggers).
  Fix: replace the comment with an accurate description, e.g.:
  "// Non-retriable — Cognito does not retry post-confirmation triggers on failure."
  npm run test:ut → /commit-fix SUG-004

deploy-SUG-004 — circuit breaker state transitions not logged
  The circuit breaker in backend/src/utils/circuitBreaker.ts transitions between states
  (closed → open, open → half-open, half-open → closed) without any log output.
  Silent state changes make production debugging difficult.
  Fix: add logger.warn calls at each transition:
    logger.warn("CircuitBreaker opened", { failureCount, threshold });
    logger.warn("CircuitBreaker half-open", { resetTimeout });
    logger.warn("CircuitBreaker closed", {});
  Use @aws-lambda-powertools/logger if imported, otherwise console.warn as fallback.
  npm run test:ut → /commit-fix deploy-SUG-004

After all fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: chore(backend): SUG-001–006 — consolidate helpers, simplify routing, add circuit breaker logging
Update ai/WORKTREES.md row p3/backend-cleanup → status: pr open
```

---

## infra-agent · `feat/p3/infra-cleanup`

```
You are the infra-agent for this worktree (feat/p3/infra-cleanup).
Verify before starting:
  git fetch origin
  git log origin/main --oneline | grep -i "IaC-008\|IaC-014\|IaC-018"

Start by reading these files:
1. .agent.md — your full domain context
2. infrastructure/stacks/CostsCrunchStack.ts — IaC-019, IaC-020, IaC-021, IaC-022
3. infrastructure/stacks/GitHubActionsStack.ts — IaC-024

CDK rule: cd infrastructure && npm run synth must pass after EVERY change.
Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd infrastructure && npm run synth

Your 5 issues, in fix order:

IaC-020 (suggested) — assetsBucket missing enforceSSL: true
  All other S3 buckets in the stack have enforceSSL: true. assetsBucket is the exception.
  Fix: add enforceSSL: true to the assetsBucket Bucket construct props.
  Synth check, then: /commit-fix IaC-020

IaC-022 (suggested) — staging uses RemovalPolicy.DESTROY
  cdk destroy on staging permanently deletes data. All other environments use RETAIN.
  Fix: change staging RemovalPolicy to RETAIN (not DESTROY).
  Confirm the condition that sets DESTROY is the staging check and update it.
  Synth check, then: /commit-fix IaC-022

IaC-021 (suggested) — EncryptionEnforcementAspect uses instanceof CfnTable
  The IAspect checks instanceof CfnTable but misses TableV2's underlying CfnTableV2.
  Tables created with TableV2 bypass the encryption enforcement check.
  Fix: change the condition to:
    if (node instanceof dynamodb.CfnTable || node instanceof dynamodb.CfnTableV2) { ... }
  Synth check, then: /commit-fix IaC-021

IaC-019 (suggested) — notifDlq and wsNotifierDlq unmonitored
  Both DLQs have no CloudWatch alarms. Poisoned messages can accumulate undetected.
  Fix: for each DLQ, add an alarm on ApproximateNumberOfMessagesVisible > 0:
    new cloudwatch.Alarm(this, 'NotifDlqAlarm', {
      metric: notifDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'notifDlq has unprocessed messages',
    }).addAlarmAction(new cw_actions.SnsAction(alarmsTopic));
  Repeat for wsNotifierDlq. Use alarmsTopic (already defined in the stack).
  Synth check, then: /commit-fix IaC-019

IaC-024 (suggested) — GitHub OIDC thumbprint single hardcoded value
  The OIDC provider configuration has only one thumbprint. GitHub currently uses two.
  Fix: add the second current thumbprint to the thumbprints array:
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
  This prevents auth failures if GitHub rotates to the second certificate.
  Synth check, then: /commit-fix IaC-024

After all 5 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: chore(infra): IaC-019 IaC-020 IaC-021 IaC-022 IaC-024 — DLQ alarms, SSL, encryption, staging retention
Update ai/WORKTREES.md row p3/infra-cleanup → status: pr open
```

---

## cicd-agent · `feat/p3/cicd-cleanup`

```
You are the cicd-agent for this worktree (feat/p3/cicd-cleanup).
Verify before starting:
  git fetch origin
  git log origin/main --oneline | grep -i "SEC-003\|CONF-001\|CONF-002"

Start by reading these files:
1. .agent.md — your full domain context
2. .github/workflows/workflow.yml — cicd-SUG-001, SUG-002
3. .github/workflows/deploy.yml — SUG-002
4. Infrastructure or CI files that start LocalStack — SUG-005
5. .github/ directory listing — confirm CODEOWNERS does not exist (SUG-007)

IMPORTANT: You can edit and commit files. You cannot push to the remote.
Skill available in this session: /commit-fix <ISSUE-ID>
Test gate:
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/workflow.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rollback.yml'))" && echo OK

Your 4 issues, in fix order:

cicd-SUG-001 (suggested) — concurrency cancel-in-progress: true cancels main runs
  workflow.yml concurrency block uses cancel-in-progress: true unconditionally. This
  cancels in-progress runs on main when a new push arrives, which can abort ongoing
  deployments or post-merge checks.
  Fix: make it branch-conditional:
    concurrency:
      group: ${{ github.workflow }}-${{ github.ref }}
      cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
  YAML lint, then: /commit-fix cicd-SUG-001

cicd-SUG-002 (suggested) — codecov flags missing
  Both workflows upload coverage without flags. Both reports overwrite the same Codecov
  report, making it impossible to distinguish frontend vs backend coverage.
  Fix: add flags to the codecov upload action in each workflow:
    workflow.yml (backend): flags: backend
    deploy.yml (frontend): flags: frontend
  YAML lint, then: /commit-fix cicd-SUG-002

cicd-SUG-005 (suggested) — LocalStack health wait loop silently exits 0 on timeout
  The health check loop for LocalStack startup exits 0 (success) even when LocalStack
  never becomes healthy, causing downstream tests to run against an unavailable stack.
  Fix: find the loop (likely in workflow.yml or a setup script). On the final iteration,
  add: exit 1 (or equivalent failure signal).
  If it's in a shell script rather than inline YAML, edit the script file.
  YAML lint (if applicable), then: /commit-fix cicd-SUG-005

cicd-SUG-007 (suggested) — no CODEOWNERS file
  No .github/CODEOWNERS exists. Pushes to main and changes to infrastructure/** require
  no designated reviewer.
  Fix: create .github/CODEOWNERS with at minimum:
    # Main branch and infrastructure require owner review
    *                    @<github-username>
    infrastructure/**    @<github-username>
    .github/**           @<github-username>
  Replace <github-username> with the repo owner's GitHub handle.
  No YAML lint needed for this file. Then: /commit-fix cicd-SUG-007

After all 4 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: chore(cicd): cicd-SUG-001 SUG-002 SUG-005 SUG-007 — concurrency, codecov flags, LocalStack, CODEOWNERS
Update ai/WORKTREES.md row p3/cicd-cleanup → status: pr open
```

---

## frontend-agent · `feat/p3/frontend-cleanup`

```
You are the frontend-agent for this worktree (feat/p3/frontend-cleanup).
Verify before starting:
  git fetch origin
  git log origin/main --oneline | grep -i "FE-006\|FE-007\|FE-008\|FE-009"

Start by reading these files:
1. .agent.md — your full domain context
2. frontend/src/components/groups/groupDetail.tsx:12 — FE-015
3. frontend/src/stores/useExpenseStore.ts:141–143 — FE-016
4. frontend/src/components/expenseDetail.tsx:172 — FE-018
5. frontend/src/pages/dashboard.tsx:44 — FE-020
6. frontend/src/pages/groups.tsx:147 — FE-022

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd frontend && npx vitest run

Your 5 issues, in fix order:

FE-022 (suggested) — groups.tsx:147 — setSortBy(e.target.value as any)
  The sort-by select casts its value to any. Fix: declare the union type:
    type SortOption = 'name' | 'spend' | 'memberCount' | 'date';
  Change the handler to: setSortBy(e.target.value as SortOption)
  And update the useState type: const [sortBy, setSortBy] = useState<SortOption>('name')
  vitest → /commit-fix FE-022

FE-015 (suggested) — groupDetail.tsx:12 — balances typed as any
  The balances state is typed as any, losing all type safety for balance calculations.
  Fix: declare a BalancesResponse interface matching the shape returned by
  GET /groups/{id}/balances. Add it to frontend/src/models/ or import from @costscrunch/api
  if the shape is defined there. Replace: any with BalancesResponse.
  vitest → /commit-fix FE-015

FE-016 (suggested) — useExpenseStore.ts:141–143 — selectMyExpenses hardcodes "You"
  selectMyExpenses filters by comparing userId to the string "You", which is a display
  label, not an actual userId.
  Fix: access the authenticated user's ID from the auth store or Amplify Auth.
  Filter: expense.userId === currentUserId (not the display name).
  vitest → /commit-fix FE-016

FE-018 (suggested) — expenseDetail.tsx:172 — expense.s3Uri not in Expense interface
  expense.s3Uri is accessed but the field is not declared in the Expense interface.
  TypeScript allows it only because the field access is not strict.
  Fix option A: add s3Uri?: string | null to the Expense interface in shared types.
  Fix option B: if s3Uri is never populated by the backend, remove the access and
  replace with the correct field name.
  Check the backend Expense DynamoDB item shape to determine which fix is correct.
  vitest → /commit-fix FE-018

FE-020 (suggested) — dashboard.tsx:44 — date heading hardcoded to "February 2026"
  The dashboard month heading is hardcoded as a string literal.
  Fix: replace with: new Date().toLocaleString('default', { month: 'long', year: 'numeric' })
  vitest → /commit-fix FE-020

After all 5 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: chore(frontend): FE-015 FE-016 FE-018 FE-020 FE-022 — type cleanup and stale hardcodes
Update ai/WORKTREES.md row p3/frontend-cleanup → status: pr open
```
