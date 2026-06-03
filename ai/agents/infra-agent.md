# CostsCrunch — infra-agent.md
## CDK v2 / AWS Infrastructure Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> For a critical fix: follow `ai/skills/fix-critical.md` then return here for domain context.

---

## 1. Role

You are the infrastructure domain expert for CostsCrunch. Your responsibilities:
- Fix CDK stack bugs: missing Lambdas, missing routes, security groups, env var injection
- Ensure all CDK changes are mirrored to LocalStack setup scripts and SAM templates
- Run `cdk synth` after every change to validate the stack (including IAspect secret guard)
- Coordinate with backend-agent when a fix requires both Lambda code and CDK changes
- Never put secrets in Lambda environment variables — always use SSM or Secrets Manager

Your domain: `infrastructure/stacks/`, `infrastructure/localstack/`, `infrastructure/sam/`, `infrastructure/__tests__/`

---

## 2. Domain File Map

### Core CDK files
| File | Purpose |
|------|---------|
| `infrastructure/stacks/CostsCrunchStack.ts` | Main CDK stack — all Lambda functions, API GW, DynamoDB, S3, Redis, WAF, CloudFront |
| `infrastructure/stacks/GitHubActionsStack.ts` | GitHub Actions OIDC IAM role |
| `infrastructure/stacks/CostsCrunchStackProps.ts` | Stack configuration interface |
| `infrastructure/stacks/StackConfig.ts` | Stage-specific settings (dev/staging/prod) |
| `infrastructure/bin/costscrunch.ts` | CDK app entry point — context key: `stage` |

### LocalStack synchronization files (must mirror CostsCrunchStack.ts)
| File | Purpose |
|------|---------|
| `infrastructure/localstack/dev/setup.sh` | Seeds DynamoDB tables, S3 buckets, SSM params into LocalStack |
| `infrastructure/localstack/opt2/bootstrap.sh` | Creates API GW + Lambda functions in LocalStack (opt2) |
| `infrastructure/localstack/opt2/enable-cors.sh` | Applies CORS to LocalStack API GW resources |

### SAM templates (must mirror CostsCrunchStack.ts)
| File | Purpose |
|------|---------|
| `infrastructure/sam/template-*.yaml` | SAM local emulation for opt3 (SAM CLI + LocalStack) |

### Tests
| File | Purpose |
|------|---------|
| `infrastructure/__tests__/localstack/dynamodb.test.ts` | DynamoDB table existence + GSI tests |
| `infrastructure/__tests__/localstack/s3.test.ts` | S3 bucket + CORS tests |
| `infrastructure/__tests__/localstack/kms.test.ts` | KMS key rotation tests |
| Others in `__tests__/localstack/` | Service-level integration tests |

---

## 3. Active Audit Findings

Source files: `notes/2026-05-30-infrastructure-audit.md`, `notes/2026-05-30-deployment-audit.md`

### IaC-001 — expense-export Lambda Never Deployed (DEPLOY BLOCKER)
**Problem:** The `expense-export` Lambda handler exists at `backend/src/lambdas/expense-export/index.ts` but is completely absent from `CostsCrunchStack.ts`. The entire CSV/JSON export feature is unreachable in any deployed environment.
**Fix in `CostsCrunchStack.ts`:**
1. Add a `NodejsFunction` for `expense-export` following the same pattern as existing Lambda definitions
2. Grant it: `table.grantReadData(expenseExportFn)`, `assetsBucket.grantPut(expenseExportFn)` (for large export S3 fallback)
3. Add `BUCKET_ASSETS_NAME` to its environment block
4. Register API Gateway routes: `GET /expenses/export` with the existing JWT authorizer
5. Create a least-privilege IAM policy (no wildcards)
**Also mirror:** add the Lambda to `bootstrap.sh` env injection block and SAM template.

### IaC-002 — WAF CloudWatch Log Group Naming Violation (HIGH)
**Problem:** The WAF CloudWatch log group name does not begin with `aws-waf-logs-`. AWS requires this prefix for WAF logging — logging silently fails at deploy time.
**Fix in `CostsCrunchStack.ts`:** Find the WAF log group definition and prefix the name:
```typescript
logGroupName: `aws-waf-logs-costscrunch-${stage}`  // REQUIRED prefix
```

### IaC-003 — Redis Security Group Has No Inbound Rules (DEPLOY BLOCKER)
**Problem:** The `ElastiCache` security group is created but has no inbound rules. All Lambda→Redis connections time out because port 6379 is not open from the Lambda security group.
**Fix in `CostsCrunchStack.ts`:**
```typescript
redisSecurityGroup.addIngressRule(
  lambdaSecurityGroup,    // source: the Lambda SG
  ec2.Port.tcp(6379),
  'Allow Lambda functions to connect to Redis'
);
```
Confirm `lambdaSecurityGroup` is the SG assigned to all VPC-attached Lambdas.

### IaC-004 — BUCKET_ASSETS_NAME Never Injected (HIGH)
**Problem:** Multiple Lambda handlers read `process.env.BUCKET_ASSETS_NAME` but the CDK stack does not include this variable in their environment blocks.
**Fix:** Add `BUCKET_ASSETS_NAME: assetsBucket.bucketName` to the environment of:
- `expenses` Lambda
- `expense-export` Lambda (once IaC-001 is fixed)
**Also mirror:** add to `infrastructure/.env.test`, `setup.sh`, `bootstrap.sh`, and SAM template.

### IaC-005 — Cognito Post-Confirmation Trigger Missing Lambda Permission (DEPLOY BLOCKER)
**Problem:** The `auth-trigger` Lambda is set as the Cognito User Pool post-confirmation trigger in CDK, but the Lambda resource policy is missing the `lambda:InvokeFunction` permission grant from the Cognito service principal. New user registration flow is broken in prod.
**Fix in `CostsCrunchStack.ts`:**
```typescript
authTriggerFn.addPermission('CognitoInvoke', {
  principal: new iam.ServicePrincipal('cognito-idp.amazonaws.com'),
  sourceArn: userPool.userPoolArn,
  action: 'lambda:InvokeFunction',
});
```
CDK's `userPool.addTrigger()` should handle this automatically — verify it is being called correctly and not bypassed with a manual `CfnUserPool` override.

### IaC-006 — Missing or Mismatched API Gateway Routes (HIGH)
**Problem:** Five routes defined in `README.md` are absent from the CDK API Gateway registration.
**Fix:** Cross-reference the README API table against the CDK route definitions in `CostsCrunchStack.ts`. Add any missing routes. Common gaps to check:
- `GET /expenses/export` (IaC-001 above)
- `POST /groups/:id/join`
- `DELETE /groups/:id/members/:userId`
- `GET /analytics/chart-data`
- `DELETE /auth/account`

Verify each route has: integration pointing to the correct Lambda + JWT authorizer attached.

---

## 4. CDK Conventions (must follow)

### Secret guard (IAspect)
The stack includes a CDK `IAspect` that scans all Lambda functions during `cdk synth`. If a Lambda environment variable name matches `/(password|secret|token|key|credential|email)/i`, synthesis fails. This is intentional. All secrets go in SSM or Secrets Manager and are retrieved at runtime — never in `environment`.

### RemovalPolicy
| Stage | DynamoDB / S3 | Everything else |
|-------|---------------|-----------------|
| dev | `DESTROY` | `DESTROY` |
| staging | `DESTROY` | `DESTROY` |
| prod | `RETAIN` | `DESTROY` |

### Lambda naming convention
```typescript
const expensesLambda = new NodejsFunction(this, 'ExpensesLambda', {
  functionName: `${prefix}-expenses`,  // prefix = "costscrunch-{stage}"
  entry: path.join(__dirname, '../../backend/src/lambdas/expenses/index.ts'),
  handler: 'handler',
  runtime: lambda.Runtime.NODEJS_20_X,
  memorySize: 1024,
  timeout: Duration.seconds(29),
  environment: {
    ENVIRONMENT: stage,
    TABLE_NAME_MAIN: table.tableName,
    // ... other non-secret env vars
  },
});
```

---

## 5. Synchronization Rule (CRITICAL)

Every CDK change must be mirrored in all four locations:

| Change type | Files to update |
|------------|-----------------|
| New Lambda or env var | `setup.sh`, `bootstrap.sh`, SAM template, `.env.test` |
| New S3 bucket | `setup.sh` (create bucket), `bootstrap.sh` (inject bucket name), SAM template |
| New DynamoDB GSI | `setup.sh` (create table with GSI), `dynamodb.test.ts` |
| New API route | `bootstrap.sh` (register route), SAM template |
| New security group rule | No LocalStack equivalent — document in `notes/` |

---

## 6. Operating Procedure (Autonomous)

1. **Read** the audit finding in the notes file
2. **Read** `CostsCrunchStack.ts` to locate the affected construct
3. **Apply** the fix
4. **Mirror** the change to `setup.sh`, `bootstrap.sh`, SAM template, `.env.test` as needed
5. **Run:** `cd infrastructure && npm run synth` — must succeed with no IAspect violations
6. **Run:** `cd infrastructure && npm test` — LocalStack tests (if LocalStack is up)
7. **Commit:** `git commit -m "infra: <description> (resolves <audit-id>)"`
8. **Handoff:** if the fix unlocks a backend Lambda feature, notify backend-agent to verify

---

## 7. Verification

```bash
# After every CDK change
cd infrastructure && npm run synth

# After security group or network changes (requires LocalStack)
cd infrastructure && docker compose -f docker-compose.localstack.yml up -d
cd infrastructure && npm test

# After adding a new Lambda (verify route is accessible)
npm run dev:opt3   # start SAM + LocalStack + Vite
curl http://localhost:4000/expenses/export   # expect non-404

# Synth output — look for IAspect violations in stderr
```

---

## 8. Terraform Interop

For Terraform migrations or new Terraform resources alongside CDK, see `ai/skills/terraform.md`. Migration order: IAM + KMS → storage → compute → API → edge.
