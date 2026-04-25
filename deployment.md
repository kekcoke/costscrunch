# CostsCrunch Deployment Guide

## Architecture Overview
CostsCrunch uses a Serverless architecture deployed via AWS CDK.
- **Frontend:** React application hosted on S3 and distributed via CloudFront.
- **Backend:** Node.js 20 Lambda functions behind an HTTP API Gateway.
- **Database:** DynamoDB (Single Table Design) with on-demand capacity.
- **Security:** AWS WAF, Cognito User Pools, and KMS Encryption at rest.

## Environments

We maintain three primary deployment contexts, configured via CDK context variables:

| Environment | Purpose | DynamoDB Billing | Provisioned Concurrency | Error Rate Alarm | Duration P99 Alarm |
|-------------|---------|-----------------|------------------------|------------------|-------------------|
| **Dev**     | Local development & feature testing | On-Demand | ❌ Off | 5% | 30,000ms |
| **Staging** | Pre-production testing & QA | On-Demand | ❌ Off | 3% | 20,000ms |
| **Prod**    | Live user traffic | Provisioned | ✅ On (500 reserved) | 1% | 10,000ms |

### Environment-Specific Configurations

#### Dev
- **Removal Policy:** `destroy` (all resources deleted on stack delete)
- **CORS:** Allows `*` (all origins)
- **MOCK_AUTH:** Permitted (blocked in staging/prod)
- **Reserved Concurrency:** 50
- **Log Retention:** 1 week

#### Staging
- **Removal Policy:** `destroy`
- **CORS:** Allows `*` (all origins)
- **MOCK_AUTH:** Blocked during synthesis
- **Reserved Concurrency:** 50
- **DynamoDB Replicas:** None (single region)
- **Log Retention:** 1 week
- **Identical to Prod EXCEPT:**
  - DynamoDB: On-Demand (not Provisioned)
  - Provisioned Concurrency: Disabled
  - Lower alarm thresholds (3% error, 20s duration)

#### Prod
- **Removal Policy:** `retain` (resources preserved on stack delete)
- **CORS:** Restricted to `https://app.costscrunch.io`
- **MOCK_AUTH:** Blocked during synthesis
- **Reserved Concurrency:** 500
- **DynamoDB Replicas:** `us-west-2` (global table)
- **DynamoDB Deletion Protection:** Enabled
- **Multi-AZ Redis:** Enabled (automatic failover)
- **Log Retention:** 3 months
- **WAF:** Attached to CloudFront distribution

---

## Manual Deployment (CLI)

### Prerequisites
1. AWS CLI configured with appropriate credentials
2. Node.js 20+ and npm
3. CDK CLI: `npm install -g aws-cdk`

### Deploy with `deploy.sh`

```bash
# Synthesize (generate CloudFormation template)
./scripts/deploy.sh staging synth

# Deploy to staging
./scripts/deploy.sh staging deploy

# Deploy to production
./scripts/deploy.sh prod deploy

# View differences from deployed stack
./scripts/deploy.sh prod diff

# Destroy a stack
./scripts/deploy.sh dev destroy
```

### Direct CDK Commands

```bash
cd infrastructure

# Deploy specific stage via context
cdk deploy --all \
  -c stage=staging \
  -c capacityMode=on-demand \
  -c provisionedConcurrency=false \
  -c alarmThreshold.errorRate=3 \
  -c alarmThreshold.durationP99=20000
```

### CDK Context Variables

| Variable | Type | Description | Dev | Staging | Prod |
|----------|------|-------------|-----|---------|------|
| `stage` | string | Environment name | `dev` | `staging` | `prod` |
| `capacityMode` | string | DynamoDB/Lambda billing | `on-demand` | `on-demand` | `provisioned` |
| `provisionedConcurrency` | boolean | Lambda reserved concurrency | `false` | `false` | `true` |
| `alarmThreshold.errorRate` | number | Error rate % threshold | 5 | 3 | 1 |
| `alarmThreshold.durationP99` | number | Duration P99 threshold (ms) | 30000 | 20000 | 10000 |

---

## CI/CD Pipeline

Deployments are managed via GitHub Actions (`.github/workflows/deploy.yml`).

### Workflow Triggers
- **Pushes to `main`:** Deploys directly to Staging, runs E2E smoke tests, and upon approval, deploys to Prod.
- **Pull Requests to `main`:** Runs Quality Gate (Lint, Unit Tests) and Security Scans (Semgrep, Gitleaks, npm audit).

### Pre-requisites for Deployment
The pipeline relies on **GitHub OIDC Federation**. Long-lived AWS access keys are NOT used.
To deploy manually, your AWS role must have permissions to assume the CDK execution roles.

---

## Testing Locally Before Deployment

Because the backend relies heavily on AWS services, **integration tests require LocalStack**.

1. **Start Local Environment:**
   ```bash
   npm run dev:opt2 # or dev:opt3 to spin up localstack
   ```

2. **Run Unit Tests (Fast, no AWS needed):**
   ```bash
   npm run test:ut -w backend
   ```

3. **Run Integration Tests (Requires LocalStack):**
   ```bash
   npm run test:ig -w backend
   ```

*(Note: Running `npm test` at the root will run both. Ensure LocalStack is up to prevent `ECONNREFUSED` errors).*

---

## Rollback Procedures

### Automated Rollbacks
The GitHub Action `rollback.yml` is triggered automatically if the post-deployment health check (`GET /health`) fails 3 consecutive times after a production deployment.

### Manual Rollbacks
To manually rollback a deployed stack:
1. Revert the problematic commit in `main`.
2. Push the revert commit, which will trigger the standard deployment pipeline to overwrite the broken state.
3. Alternatively, use AWS CloudFormation console to execute a stack rollback to the previous known good state.
