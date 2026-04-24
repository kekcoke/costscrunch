# CostsCrunch Deployment Guide

## Architecture Overview
CostsCrunch uses a Serverless architecture deployed via AWS CDK. 
- **Frontend:** React application hosted on S3 and distributed via CloudFront.
- **Backend:** Node.js 20 Lambda functions behind an HTTP API Gateway.
- **Database:** DynamoDB (Single Table Design) with on-demand capacity.
- **Security:** AWS WAF, Cognito User Pools, and KMS Encryption at rest.

## Environments
We maintain three primary deployment contexts:

| Environment | Purpose | Configuration Differences |
|-------------|---------|---------------------------|
| **Dev**     | Local development & feature testing. | Uses LocalStack. `MOCK_AUTH` allowed. |
| **Staging** | Pre-production testing & QA. | On-demand Lambda, scaled-down DB capacity, lower alarm thresholds. |
| **Prod**    | Live user traffic. | Provisioned Concurrency, WAF attached, Multi-AZ Redis, strict `DISABLE_AUTH` guards. |

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
