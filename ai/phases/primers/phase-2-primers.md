# Phase 2 Primers — Important Issues
> Copy-paste the relevant section when opening a Phase 2 worktree session.
> Each primer assumes `.agent.md` has been injected and the Phase 1 dependency has merged.

---

## backend-agent · `feat/p2/backend-perf`

```
You are the backend-agent for this worktree (feat/p2/backend-perf).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "PERF-002\|SF-004\|SF-005"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/lambdas/image-preprocess/index.ts — CON-003 (lines 117–121)
3. backend/src/lambdas/web-socket-notifier/index.ts — CON-004 (lines 152–173, 202–222)
4. backend/src/lambdas/sns-webhook/index.ts — PERF-003 (line 157)
5. backend/src/lambdas/groups/index.ts — SCALE-001 (196–207), SCALE-003 (182–186)
6. backend/src/logic/analyticsRepository.ts — SCALE-002 (51–67)

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd backend && npm run test:ut
Integration gate (LocalStack required for SCALE issues): cd backend && npm run test:ig

Your 7 issues, in fix order:

CON-003 (IMPORTANT) — image-preprocess/index.ts:117–121
  ApiGatewayManagementApiClient is constructed inside notifyUserViaWebSocket on every call.
  S3 events can batch multiple records; each quarantine creates a new SDK client, repeating
  TLS handshake and credential resolution.
  Fix: hoist the client construction to module scope, matching the web-socket-notifier
  pattern at line 33 of that file.
  After fix: npm run test:ut → /commit-fix CON-003

CON-004 (IMPORTANT) — web-socket-notifier/index.ts:152–173,202–222
  handleReceiptScanCompleted and handleQuarantineEvent contain identical 20-line
  Promise.allSettled fan-out blocks. A bug fix must be applied twice.
  Fix: extract into a shared pushToUsers(userId: string, payload: unknown): Promise<void>
  helper function within the file. Both handlers call it identically.
  After fix: npm run test:ut → /commit-fix CON-004

PERF-003 (IMPORTANT) — sns-webhook/index.ts:157
  guessCategory compiles new RegExp(...) per keyword per category on every invocation
  (~35 keywords × 6 categories = ~210 regex compiles per call). Keywords are a static
  module-level constant.
  Fix: precompile one RegExp per category at module init:
    const categoryPatterns = Object.fromEntries(
      Object.entries(CATEGORY_KEYWORDS).map(([cat, kws]) => [
        cat,
        new RegExp(kws.map(k => `\\b${k}\\b`).join('|'), 'i')
      ])
    );
  Replace the runtime compile loop with a lookup into categoryPatterns.
  After fix: npm run test:ut → /commit-fix PERF-003

PERF-004 (IMPORTANT) — image-preprocess/index.ts:330,350
  Comments describe JPEG processing as "lossless" but quality: 100 is still lossy.
  Re-compressing existing JPEGs degrades Textract accuracy on subsequent runs.
  Fix: for existing JPEGs (input is already a JPEG), use Sharp withMetadata().rotate()
  for auto-orient only (no re-encode) and copy unchanged to the processed bucket.
  For non-JPEG inputs (PNG, HEIC), the existing quality: 100 path is acceptable.
  Add a conditional: if (inputFormat === 'jpeg') { /* orient-only path */ } else { /* existing */ }
  After fix: npm run test:ut → /commit-fix PERF-004

SCALE-001 (IMPORTANT) — groups/index.ts:196–207
  GET /groups/{id}/balances loads the entire expense history into Lambda memory
  with no date filter or limit. Will OOM for groups with large expense histories.
  Fix: add FilterExpression: "#status <> :reimbursed" with ExpressionAttributeNames and
  ExpressionAttributeValues to the QueryCommand so only unsettled expenses are loaded.
  Use expression attribute name #status to avoid the reserved-word conflict.
  After fix: npm run test:ut (and npm run test:ig if LocalStack is available) → /commit-fix SCALE-001

SCALE-002 (IMPORTANT) — logic/analyticsRepository.ts:51–67
  scope=all issues 1+N DynamoDB queries: one for group memberships, then one per group.
  A user in 20 groups generates 21 sequential requests per analytics page load.
  Fix: replace the sequential QueryCommand per group with a single BatchGetItemCommand
  that fetches all group analytics records in one request. Key shape: pk=GROUP#<gid>,
  sk=ANALYTICS#<period>. Handle unprocessed keys with the standard retry loop.
  After fix: npm run test:ut → /commit-fix SCALE-002

SCALE-003 (IMPORTANT) — groups/index.ts:182–186
  GET /groups retrieves all GROUP_MEMBER#* SK items then uses FilterExpression to exclude
  inactive ones. DynamoDB charges for all read items before the filter.
  Fix: model active/inactive in the SK prefix: ACTIVE_GROUP_MEMBER# vs INACTIVE_GROUP_MEMBER#.
  The KeyConditionExpression then matches only active memberships.
  WARNING: this is a DynamoDB schema change. If staging has real data, flag the human
  before committing — a data migration is required for existing GROUP_MEMBER# items.
  After fix: npm run test:ut → /commit-fix SCALE-003

After all 7 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(backend): CON-003 CON-004 PERF-003 PERF-004 SCALE-001 SCALE-002 SCALE-003
Update ai/WORKTREES.md row p2/backend-perf → status: pr open
```

---

## backend-agent · `feat/p2/backend-safety`

```
You are the backend-agent for this worktree (feat/p2/backend-safety).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "PERF-002\|SF-004\|SF-005"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/lambdas/web-socket-handler/index.ts — SF-006 (lines 47–55)
3. backend/src/lambdas/web-socket-notifier/index.ts — SF-007 (lines 152–173)
4. backend/src/lambdas/sns-webhook/index.ts — SF-008 (337–354), SF-009 (557–581)
5. backend/src/lambdas/expenses/index.ts — SIMP-001 (152–156)
6. backend/src/lambdas/expense-export/index.ts — SIMP-001 (65–67)
7. backend/src/lambdas/groups/index.ts — SIMP-002, OPS-001
8. backend/src/lambdas/image-preprocess/index.ts — DEP-003 (line 40)

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd backend && npm run test:ut
Integration gate (for SF-006, which touches DynamoDB connection records): cd backend && npm run test:ig

Your 8 issues, in fix order:

SF-009 (IMPORTANT) — sns-webhook/index.ts:557–581
  When a receipt is flagged as a duplicate, the scan record remains in "processing" forever
  (the loop hits continue without writing a terminal status).
  Fix: before the continue statement, write status: "duplicate" to the scan record in DynamoDB.
  After fix: npm run test:ut → /commit-fix SF-009

SF-008 (IMPORTANT) — sns-webhook/index.ts:337–354
  ResourceNotFoundException in duplicate detection silently disables the check and returns
  { isDuplicate: false }. Both "GSI missing" and "table misconfigured" produce the same
  silent bypass — the catch block swallows the exception entirely.
  Fix: in the catch block for ResourceNotFoundException, emit a warning metric using
  logger.warn("DuplicateCheckSkipped", { error }) and a CloudWatch custom metric
  putMetricData call (or @aws-lambda-powertools/metrics). Still return { isDuplicate: false }
  to preserve the non-blocking behaviour, but make it observable.
  After fix: npm run test:ut → /commit-fix SF-008

SF-007 (IMPORTANT) — web-socket-notifier/index.ts:152–173
  Promise.allSettled only re-throws when ALL connections fail. Partial failures
  (1 of 10 users not notified) are absorbed silently without any signal.
  Fix: after the allSettled, count rejected results and emit a CloudWatch metric
  WsPartialFailures with the count. Use @aws-lambda-powertools/metrics if already imported.
  Optionally collect failed connectionIds and push to the wsNotifierDlq SQS queue for retry.
  After fix: npm run test:ut → /commit-fix SF-007

SF-006 (IMPORTANT) — web-socket-handler/index.ts:47–55
  The $disconnect handler logs and returns 200 without deleting the connection record
  from DynamoDB. Stale records accumulate indefinitely and waste WS fan-out budget.
  Fix: read the connectionId from event.requestContext.connectionId. Add a DeleteCommand
  to remove the connection record. Check CostsCrunchStack.ts for the GSI on connectionId
  — if it does not exist, add it there first (coordinate with infra-agent if needed,
  or add a note in your PR for follow-up).
  After fix: npm run test:ut (and npm run test:ig if LocalStack is up) → /commit-fix SF-006

SIMP-001 (IMPORTANT) — expenses/index.ts:152–156, expense-export/index.ts:65–67
  Hardcoded userId override ("local-user-uuid-123" → "test-user-001") runs unconditionally
  in production, not gated on MOCK_AUTH.
  Fix: wrap both overrides in: if (process.env.MOCK_AUTH === 'true') { ... }
  This is a security fix — these overrides must never execute in staging or prod.
  After fix: npm run test:ut → /commit-fix SIMP-001

SIMP-002 (IMPORTANT) — groups/index.ts:81–82,136–137,147
  Three console.log calls fire on every request, bypassing @aws-lambda-powertools/logger.
  Fix: replace each with logger.debug(...) using structured arguments, or remove if the
  log content is not useful. Never use console.log in Lambda handlers.
  After fix: npm run test:ut → /commit-fix SIMP-002

OPS-001 (IMPORTANT) — groups/index.ts:206
  console.log(`[DEBUG] Balances count: ...`) bypasses structured logging and produces
  unstructured CloudWatch noise.
  Fix: logger.debug("Balances calculated", { balancesCount, settlementsCount })
  After fix: npm run test:ut → /commit-fix OPS-001

DEP-003 (IMPORTANT) — image-preprocess/index.ts:40
  WEBSOCKET_ENDPOINT is injected only into wsNotifierLambda. imagePreprocessLambda reads
  process.env.WEBSOCKET_ENDPOINT || "" and silently skips quarantine push notifications
  when the string is empty.
  Backend side fix: verify the read (process.env.WEBSOCKET_ENDPOINT || "") is correct
  and add a logger.warn if the value is empty at startup.
  The CDK injection side is covered by IaC-011 in p2/infra — coordinate with infra-agent.
  Note in your PR that IaC-011 must merge before this fix takes effect in deployed environments.
  After fix: npm run test:ut → /commit-fix DEP-003

After all 8 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(backend): SF-006 SF-007 SF-008 SF-009 SIMP-001 SIMP-002 OPS-001 DEP-003
Update ai/WORKTREES.md row p2/backend-safety → status: pr open
```

---

## types-agent · `feat/p2/types`

```
You are the types-agent for this worktree (feat/p2/types).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "PERF-002\|SF-004\|SF-005"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/src/shared/models/types.ts — TDA-001 (line 6)
3. backend/src/shared/validation/schemas.ts — TDA-001 (line 23), TDA-004
4. backend/src/utils/withErrorHandler.ts — TDA-002 (lines 11–15)
5. backend/src/logic/analyticsRepository.ts — TDA-003 (lines 20–95)
6. backend/src/shared/auth/middleware.ts — TDA-005 (lines 64–91)

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd backend && npx tsc --noEmit && npm run test:ut
(Both must pass. tsc is the primary gate for type issues.)

IMPORTANT: Do not modify handler logic — only types, interfaces, and schemas.
If making withErrorHandler generic (TDA-002) requires callers to add type annotations,
list the affected files in your PR description. Do not silently break callers.

Your 5 issues, in fix order:

TDA-001 (IMPORTANT) — shared/models/types.ts:6, shared/validation/schemas.ts:23
  ExpenseStatus TypeScript type and Zod schema are out of sync: schema accepts "pending",
  type does not. One source of truth must own the definition; the other derives from it.
  Recommended: make Zod the source of truth. Define the enum in schemas.ts:
    export const ExpenseStatusSchema = z.enum(['pending', 'approved', 'rejected', 'reimbursed']);
    export type ExpenseStatus = z.infer<typeof ExpenseStatusSchema>;
  Remove the duplicate type definition in types.ts; import ExpenseStatus from schemas.ts.
  After fix: npx tsc --noEmit && npm run test:ut → /commit-fix TDA-001

TDA-004 (IMPORTANT) — shared/validation/schemas.ts, CreateExpenseRequest.category
  category is z.string().max(50), allowing arbitrary strings to be written to DynamoDB.
  Fix: replace with z.enum(['Groceries','Travel','Software','Meals','Office','Equipment','Other'])
  .optional().default('Other')
  Confirm the enum values match the CategoryName type in types.ts (align both in the same
  PR if they differ — do not introduce a new mismatch).
  After fix: npx tsc --noEmit && npm run test:ut → /commit-fix TDA-004

TDA-002 (IMPORTANT) — utils/withErrorHandler.ts:11–15
  Wrapper accepts event: any, disabling compile-time type checking for every Lambda handler.
  Fix: make the wrapper generic:
    export const withErrorHandler = <E>(
      handler: (event: E, context: Context) => Promise<APIGatewayProxyResult>
    ) => async (event: E, context: Context): Promise<APIGatewayProxyResult> => { ... }
  Export handlers remain typed at their call sites via the generic parameter.
  Check all handler exports for type errors after this change — they may need explicit
  type annotations on their event parameter. List affected files in PR description.
  After fix: npx tsc --noEmit && npm run test:ut → /commit-fix TDA-002

TDA-003 (IMPORTANT) — logic/analyticsRepository.ts:20–95
  getExpenses returns Promise<any[]>. All field access in the analytics pipeline is untyped.
  Fix: change return type to Promise<Expense[]>. At the DynamoDB boundary (after QueryCommand
  result), add a validated cast:
    items.map(item => ExpenseSchema.parse(item)) as Expense[]
  Use the existing ExpenseSchema from schemas.ts for validation.
  After fix: npx tsc --noEmit && npm run test:ut → /commit-fix TDA-003

TDA-005 (IMPORTANT) — shared/auth/middleware.ts:64–91
  withAuth error branch returns { statusCode: 401 } as unknown as TResult. The function
  promises TResult but delivers a raw response; callers cannot detect the substitution
  at compile time.
  Fix: change the return type to an explicit union: TResult | APIGatewayProxyResult.
  Update the function signature:
    export const withAuth = <TResult>(
      handler: (event: AuthorizedEvent) => Promise<TResult>
    ): (event: ApiEvent) => Promise<TResult | APIGatewayProxyResult> => ...
  Verify no callers rely on the as unknown as TResult cast — they should now handle both
  variants correctly, or the 401 branch will be caught by withErrorHandler upstream.
  After fix: npx tsc --noEmit && npm run test:ut → /commit-fix TDA-005

After all 5 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(types): TDA-001 TDA-002 TDA-003 TDA-004 TDA-005 — type safety across shared utils
Update ai/WORKTREES.md row p2/types → status: pr open
```

---

## infra-agent · `feat/p2/infra`

```
You are the infra-agent for this worktree (feat/p2/infra).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "IaC-007"

Start by reading these files:
1. .agent.md — your full domain context
2. infrastructure/stacks/CostsCrunchStack.ts — most IaC issues live here
3. infrastructure/stacks/GitHubActionsStack.ts — IaC-017
4. infrastructure/bin/costscrunch.ts — IaC-012
5. package.json (root) scripts section — IaC-012

CDK rule: cd infrastructure && npm run synth must pass after EVERY change.
Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd infrastructure && npm run synth

Your 11 issues, in fix order (security/correctness first):

IaC-014 (IMPORTANT) — CostsCrunchStack.ts:670
  authTriggerLambda has grantWriteData only. GetItem/Query calls during profile
  creation hit AccessDeniedException.
  Fix: table.grantReadWriteData(authTriggerLambda)
  Synth check, then: /commit-fix IaC-014

IaC-015 (IMPORTANT) — CostsCrunchStack.ts:485–510
  Bedrock client in sns-webhook is hardcoded to us-east-1; no BEDROCK_REGION in sharedEnv.
  Fix: add BEDROCK_REGION: props.bedrockRegion ?? props.region to sharedEnv (or hardcode
  the prop value). In the lambda, change the client instantiation to:
    new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION })
  Synth check, then: /commit-fix IaC-015

IaC-016 (IMPORTANT) — CostsCrunchStack.ts:691–694,728–731
  execute-api:ManageConnections policy is added twice to wsNotifierLambda (exact duplicate
  at lines 728–731).
  Fix: remove lines 728–731 (the second addToPolicy block).
  Synth check, then: /commit-fix IaC-016

IaC-012 (IMPORTANT) — bin/costscrunch.ts:34, package.json scripts
  Deploy scripts pass --context env=staging but CDK reads tryGetContext("stage").
  Context key mismatch: every deploy silently applies dev config.
  Fix: standardize on --context stage=<env> in all npm scripts in package.json.
  In bin/costscrunch.ts verify app.node.tryGetContext("stage") is used (not "env").
  If there is a dead bin/app.ts, delete it.
  Synth check with: cd infrastructure && npm run synth (confirm stage context is read),
  then: /commit-fix IaC-012

IaC-008 (IMPORTANT) — CostsCrunchStack.ts:58
  provisionedConcurrency prop is computed per stage but never applied to any Lambda.
  Prod incurs cold starts despite the intent.
  Fix: for each key Lambda (expenses, groups, sns-webhook at minimum), add:
    const alias = fn.addAlias('live');
    if (useProvisionedConcurrency) {
      const scaling = alias.addAutoScaling({ minCapacity: 1, maxCapacity: 10 });
      scaling.scaleOnUtilization({ utilizationTarget: 0.5 });
    }
  Synth check, then: /commit-fix IaC-008

IaC-009 (IMPORTANT) — CostsCrunchStack.ts:153,187
  capacityMode prop is resolved but billing always hardcodes onDemand().
  Fix: conditional billing:
    billing: capacityMode === 'provisioned'
      ? dynamodb.Billing.provisioned({ readCapacity: ..., writeCapacity: ... })
      : dynamodb.Billing.onDemand()
  Use a reasonable provisioned capacity for staging (5/5) and prod (50/20) or make it a prop.
  Synth check, then: /commit-fix IaC-009

IaC-010 (IMPORTANT) — CostsCrunchStack.ts:388
  Redis cacheNodeType ternary evaluates "cache.t2.micro" in both branches (no-op).
  Fix: cacheNodeType: isProd ? "cache.t4g.small" : "cache.t2.micro"
  Synth check, then: /commit-fix IaC-010

IaC-011 (IMPORTANT) — CostsCrunchStack.ts:497,806 (same root as DEP-003)
  WEBSOCKET_ENDPOINT is injected only into wsNotifierLambda. imagePreprocessLambda reads
  process.env.WEBSOCKET_ENDPOINT || "" and silently skips quarantine notifications.
  Fix: after the WebSocket stage is created, add:
    imagePreprocessLambda.addEnvironment("WEBSOCKET_ENDPOINT", wsStage.callbackUrl);
  Synth check, then: /commit-fix IaC-011

IaC-013 (IMPORTANT) — CostsCrunchStack.ts:1250–1263
  wsHandlerLambda is absent from lambdaMonitoring. WebSocket connect/disconnect failures
  produce no alarms.
  Fix: add { fn: wsHandlerLambda, timeout: 29 } to the lambdaMonitoring array.
  Synth check, then: /commit-fix IaC-013

IaC-017 (IMPORTANT) — stacks/GitHubActionsStack.ts:40–44
  CfnOIDCProvider will fail with EntityAlreadyExists if the OIDC provider exists in the account.
  Fix: replace CfnOIDCProvider with:
    OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GithubOidcProvider',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`
    )
  This imports the existing provider instead of creating a new one.
  Synth check, then: /commit-fix IaC-017

IaC-018 (IMPORTANT) — CostsCrunchStack.ts:1241–1246
  alarmsTopic has no subscriptions. All Lambda, DynamoDB, and DLQ alarms publish to it
  but nobody is notified.
  Fix: add a CDK parameter for the alarm email, then:
    alarmsTopic.addSubscription(new subs.EmailSubscription(alarmEmail));
  Where alarmEmail is read from a CDK context variable or SSM parameter (never hardcoded).
  Synth check, then: /commit-fix IaC-018

After all 11 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(infra): IaC-008 through IaC-018 — Lambda config, monitoring, and correctness fixes
Update ai/WORKTREES.md row p2/infra → status: pr open
```

---

## cicd-agent · `feat/p2/cicd`

```
You are the cicd-agent for this worktree (feat/p2/cicd).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "BUG-001\|BUG-002\|BUG-003"

Start by reading these files:
1. .agent.md — your full domain context
2. .github/workflows/workflow.yml
3. .github/workflows/deploy.yml
4. .github/workflows/rollback.yml

IMPORTANT: You can edit and commit workflow YAML. You cannot push to the remote.
After committing all fixes, flag the human to push and monitor the GitHub Actions run.

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate (after every edit):
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/workflow.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo OK
  python3 -c "import yaml; yaml.safe_load(open('.github/workflows/rollback.yml'))" && echo OK

Your 9 issues, in fix order (correctness before consolidation):

SEC-003 (IMPORTANT) — workflow.yml, deploy.yml — no permissions block
  No permissions block at workflow or job level. OIDC token requests depend on org-level
  permissive defaults; tightening org settings would silently break both pipelines.
  Fix: add at workflow level in both files:
    permissions:
      contents: read
      id-token: write
  Then restrict per-job where possible (jobs that don't need id-token: drop it at job level).
  YAML lint, then: /commit-fix SEC-003

SEC-004 (IMPORTANT) — deploy.yml:138–144,200–206
  rollback.yml is called without secrets: inherit. SLACK_WEBHOOK_URL is empty in the
  reusable workflow; Slack notifications always fail silently after deployment.
  Fix: add secrets: inherit to both uses: ./.github/workflows/rollback.yml blocks.
  YAML lint, then: /commit-fix SEC-004

BUG-004 (IMPORTANT) — rollback.yml:92–97
  Fallback path runs git rev-parse HEAD~1 and git checkout $PREV_COMMIT with no prior
  actions/checkout step. No repository is cloned; the commands fail.
  Fix: add as first steps in the job:
    - uses: actions/checkout@<SHA>  # use same SHA as rest of file
      with: { fetch-depth: 2 }
    - uses: actions/setup-node@<SHA>
      with: { node-version: '20' }
    - run: npm ci
  Prefer the primary cloudformation rollback-stack path; only use the git fallback
  when no previous CF template exists, and fail explicitly in that case.
  YAML lint, then: /commit-fix BUG-004

BUG-005 (IMPORTANT) — deploy.yml:147–156
  deploy-prod needs: [build, deploy-staging] but not post-deploy-staging. Production
  can start deploying while the staging health check and rollback are still running.
  Fix: add post-deploy-staging to deploy-prod's needs list. Gate on:
    if: needs.post-deploy-staging.outputs.health_check_passed == 'true'
  (or equivalent output from that job).
  YAML lint, then: /commit-fix BUG-005

BUG-008 (IMPORTANT) — deploy.yml:152–156
  deploy-prod uses if: always(). Cancelling the workflow after deploy-staging succeeds
  still runs deploy-prod.
  Fix: remove if: always(). The explicit result checks on needs.build.result and
  needs.deploy-staging.result are sufficient.
  YAML lint, then: /commit-fix BUG-008

BUG-007 (IMPORTANT) — deploy.yml:134–144
  post-deploy-staging has if: always() and fires even when deploy-staging is skipped
  (SKIP_STAGING=true). If staging is unhealthy for an unrelated reason, a rollback
  triggers for a stack that wasn't touched.
  Fix: change the condition to:
    if: always() && needs.deploy-staging.result != 'skipped'
  YAML lint, then: /commit-fix BUG-007

BUG-006 (IMPORTANT) — deploy.yml:89–95
  cdk.out/ is excluded from the build artifact. Deploy jobs re-synthesize CDK from scratch,
  violating build-once/deploy-many. The deployed template is not the artifact that passed
  security checks.
  Fix:
  1. In the build job, include infrastructure/cdk.out/ in the uploaded artifact.
  2. In deploy-staging and deploy-prod jobs, download the artifact and pass --app cdk.out
     to the CDK deploy command instead of re-synthesizing.
  YAML lint, then: /commit-fix BUG-006

CONF-002 (IMPORTANT) — deploy.yml (missing concurrency block)
  No concurrency block. Two rapid pushes to main run two parallel CDK deploys against
  the same stack, causing RESOURCE_IN_USE CloudFormation errors or partial deploys.
  Fix: add at the top level of deploy.yml:
    concurrency:
      group: deploy-${{ github.ref }}
      cancel-in-progress: false
  YAML lint, then: /commit-fix CONF-002

CONF-001 (IMPORTANT) — workflow.yml:3–9, deploy.yml:3–8
  Both pipelines trigger on the same events. Every push to main runs doubled CI at
  double cost with two confusing sets of status checks.
  Fix: consolidate into a single pipeline. Convert deploy.yml to a workflow_call reusable
  workflow; trigger it from workflow.yml on push to main using on: workflow_call.
  Read both files thoroughly before touching this — it's the largest structural change.
  Do it last, after all other cicd issues are committed in this PR.
  YAML lint, then: /commit-fix CONF-001

After all 9 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(cicd): SEC-003 SEC-004 BUG-004–008 CONF-001 CONF-002 — pipeline hardening
Update ai/WORKTREES.md row p2/cicd → status: pr open
After the human confirms the first GitHub Actions run is green, update status → merged.
```

---

## frontend-agent · `feat/p2/frontend`

```
You are the frontend-agent for this worktree (feat/p2/frontend).
Verify before starting: git fetch origin && git log origin/main --oneline | grep -i "PERF-002\|SF-004\|SF-005"

Start by reading these files:
1. .agent.md — your full domain context
2. frontend/src/helpers/auth-api.ts — FE-006
3. frontend/src/services/api.ts:340–413 — FE-006
4. frontend/src/pages/groups.tsx:43–53 — FE-007
5. frontend/src/stores/useExpenseStore.ts:31 — FE-008
6. frontend/src/components/expenseDetail.tsx:25–43 — FE-009
7. frontend/src/components/groups/groupDetail.tsx:30–43 — FE-010
8. frontend/src/pages/dashboard.tsx:20, frontend/src/pages/groups.tsx:15 — FE-011
9. frontend/src/pages/settings.tsx:164–165 — FE-012
10. frontend/src/hooks/useWebSocket.ts:13–65 — FE-013
11. frontend/src/pages/analytics.tsx:256–289 — FE-014

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate: cd frontend && npx vitest run
Visual check required (dev server) for FE-006, FE-013, FE-014.

Your 9 issues, in fix order:

FE-006 (IMPORTANT) — helpers/auth-api.ts, services/api.ts:340–413
  Two independent authApi modules. helpers/auth-api.ts lacks bearer token injection,
  hardcodes localhost:3001 as fallback, and logout() only clears localStorage without
  calling POST /auth/logout. Cognito refresh tokens remain live after logout.
  Fix: delete helpers/auth-api.ts entirely. For each auth page that imports from
  helpers/auth-api.ts, update the import to services/api.ts. The services/api.ts
  authApi.logout() must call POST /auth/logout before clearing localStorage.
  Run vitest to catch import errors, then: /commit-fix FE-006

FE-012 (IMPORTANT) — pages/settings.tsx:164–165
  deleteAccount sends userId and email in the request body. Server-side identity should
  come from the JWT only (even after the backend SF-003 fix).
  Fix: update authApi.deleteAccount() to send no body (or empty body).
  Server derives identity from JWT. Remove userId and email from the call site.
  vitest, then: /commit-fix FE-012

FE-008 (IMPORTANT) — stores/useExpenseStore.ts:31
  fetchExpenses interface signature has no parameters; implementation accepts isLoadMore = false.
  The public interface is a lie; calling fetchExpenses(true) (done in expenses.tsx:266)
  is invisible at compile time.
  Fix: update the interface to: fetchExpenses: (isLoadMore?: boolean) => Promise<void>
  vitest, then: /commit-fix FE-008

FE-009 (IMPORTANT) — components/expenseDetail.tsx:25–43
  When initialExpense.id changes (user clicks a different expense), error, submitting,
  isEditing, isUploading retain their prior values. An upload error on expense A persists
  when viewing expense B.
  Fix: at the top of the useEffect (before the fetch), reset all derived state:
    setError(null); setSubmitting(false); setIsEditing(false); setIsUploading(false);
  vitest, then: /commit-fix FE-009

FE-010 (IMPORTANT) — components/groups/groupDetail.tsx:30–43
  fetchGroup has no .catch(). Network failures set group=null and render "Group not found"
  regardless of whether the group is absent or unreachable.
  Fix: add a catch block that sets an error state. Show "Group not found" only on 404;
  show a network error message on other failures.
  vitest, then: /commit-fix FE-010

FE-011 (IMPORTANT) — pages/dashboard.tsx:20, pages/groups.tsx:15
  fetchGroups() called independently in both pages on every mount with no deduplication.
  Dashboard → Groups → Dashboard = 3 full API calls for the same data.
  Fix: add lastFetchedAt: number | null to the group store. In fetchGroups(), add:
    if (lastFetchedAt && Date.now() - lastFetchedAt < 30_000) return;
  Reset lastFetchedAt to null when groups are mutated (create, delete, join).
  vitest, then: /commit-fix FE-011

FE-007 (IMPORTANT) — pages/groups.tsx:43–53
  handleSubmit calls groupsApi.create(...) then closes the modal without calling
  fetchGroups(). New group is absent from the list until full page reload.
  Fix: after the successful create response, call useGroupStore.getState().fetchGroups()
  or the equivalent store action before closing the modal.
  vitest, then: /commit-fix FE-007

FE-013 (IMPORTANT) — hooks/useWebSocket.ts:13–65
  In React Strict Mode, effects fire twice. The first socket's handlers (onopen, onmessage,
  onclose) stay live after re-mount and call setStatus/setLastMessage on a stale instance.
  Fix: capture socket in a local variable at effect creation time. In each handler, add:
    if (socket !== ws.current) return;
  before any state updates. This guards against stale handler invocations.
  Start dev server to verify visually, then: vitest → /commit-fix FE-013

FE-014 (IMPORTANT) — pages/analytics.tsx:256–289
  Category dropdown has no outside-click or focus-out close handler. Once opened, only
  the toggle button closes it; clicking elsewhere leaves it open.
  Fix: add a useEffect that attaches document.addEventListener("mousedown", handler)
  where handler calls setOpen(false) if the click target is outside the dropdown ref.
  Return () => document.removeEventListener("mousedown", handler) for cleanup.
  Start dev server to verify visual close behaviour, then: vitest → /commit-fix FE-014

After all 9 fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: fix(frontend): FE-006–FE-014 — auth deduplication, state cleanup, and UX fixes
Update ai/WORKTREES.md row p2/frontend → status: pr open
```

---

## qa-agent · `feat/p2/qa`

```
You are the qa-agent for this worktree (feat/p2/qa).
This worktree is blocked until BOTH p2/backend-perf AND p2/backend-safety merge.
Verify before starting:
  git fetch origin
  git log origin/main --oneline | grep -i "CON-003\|CON-004\|PERF-003\|SF-006\|SF-007"

Start by reading these files:
1. .agent.md — your full domain context
2. backend/vite.config.ts:54–57 — TEST-003 coverage config
3. backend/__tests__/unit/ — existing test structure
4. backend/__tests__/unit/health.test.ts (non-standard path) — TEST-004

Skill available in this session: /commit-fix <ISSUE-ID>
Test gate (unit): cd backend && npm run test:ut
Test gate (integration, requires LocalStack): cd backend && npm run test:ig
Coverage must not regress: 75% functions/lines, 70% branches.

Your 2 issues, in fix order:

TEST-003 (IMPORTANT) — vite.config.ts:54–57
  Coverage configuration excludes src/utils/ and src/logic/. Core utilities
  (circuitBreaker.ts, transactWriteWithRetry.ts, analyticsRepository.ts, authService.ts)
  are not subject to the 70–75% thresholds.
  Fix: add to coverage.include in vite.config.ts:
    "src/utils/**/*.ts",
    "src/logic/**/*.ts"
  After adding, run coverage to see current numbers:
    cd backend && npm run test:coverage
  If coverage is below threshold for the newly included files, add minimal tests to
  bring them above the threshold before committing.
  cd backend && npm run test:ut → /commit-fix TEST-003

TEST-004 (IMPORTANT) — __tests__/unit/
  The health Lambda test is at a non-standard path not matched by the test runner glob.
  The notifications Lambda has no test at all.
  Fix:
  1. Move __tests__/unit/lambdas/health.test.ts → __tests__/unit/health.unit.test.ts
     (or whatever the glob pattern in vite.config.ts matches — check it first).
  2. Add __tests__/unit/notifications.unit.test.ts with at minimum:
     - A test that the handler exports a function
     - A test for the happy path (mock the SES/SNS client)
     Use aws-sdk-client-mock (ddbMock pattern) — never mock the client at module level.
     Reference ai/skills/write-vitest-tests.md for canonical mock patterns.
  cd backend && npm run test:ut → confirm both tests are discovered and pass.
  Then: /commit-fix TEST-004

After both fixes are committed:
Flag the human to push and open a PR. Target branch: main.
Title: test(qa): TEST-003 TEST-004 — coverage include utils/logic, fix health path, add notifications
Update ai/WORKTREES.md row p2/qa → status: pr open
```
