# CostsCrunch — localstack-to-ministack.md
## Migration Skill: LocalStack → Ministack

> Referenced by: `ai/agents/localstack-agent.md`
> Status: **Groundwork only** — ministack tool TBD. Fill in §2 placeholders once the tool is confirmed before executing any migration steps.

---

## 1. Purpose

This skill governs the migration of CostsCrunch's local development environment from LocalStack (free tier) to ministack. It documents:
- The complete service inventory that must be replicated
- Decision-point questions that must be answered before migration starts
- A file-by-file migration checklist
- A parallel-running strategy for zero-disruption transition
- Rollback procedure

---

## 2. Ministack Tool Definition

> **Fill this section before executing any migration steps.**

| Field | Value |
|-------|-------|
| Tool name | ministack |
| Version | TBD |
| Docker image | TBD |
| Default endpoint | TBD (e.g., `http://localhost:XXXX`) |
| AWS endpoint env var format | TBD (replace `http://localhost:4566`) |
| Installation | TBD |
| Documentation | TBD |
| Lambda invocation model | TBD (same as LocalStack? different container strategy?) |
| Service parity vs LocalStack free | TBD |

---

## 3. Pre-Migration Decision Points

Answer every question below before writing a single line of migration code. A "No" on any critical question means the migration cannot proceed until ministack is extended or a workaround is designed.

### Critical (migration blocked if unsupported)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| D-01 | Does ministack support DynamoDB with GSIs (Global Secondary Indexes)? | TBD | Single-table design uses 3 GSIs — this is non-negotiable |
| D-02 | Does ministack support DynamoDB TTL? | TBD | Required for notification + scan result cleanup |
| D-03 | Does ministack support DynamoDB TransactWrite? | TBD | Required for atomic group join + settlement operations |
| D-04 | Does ministack support S3 CORS configuration? | TBD | Required for presigned POST upload flow from browser |
| D-05 | Does ministack support S3 presigned URLs? | TBD | Core of the receipt upload flow |
| D-06 | Does ministack support FIFO SQS? | TBD | Required for `notifications.fifo` queue |
| D-07 | Does ministack support SQS Dead Letter Queues? | TBD | Required for scan-dlq and ws-notifier-dlq |
| D-08 | Does ministack support SNS topic subscriptions to SQS? | TBD | Textract completion → SQS fan-out |
| D-09 | Does ministack support EventBridge custom buses and rules? | TBD | Required for ReceiptScanCompleted → notifications routing |
| D-10 | Does ministack support SSM Parameter Store? | TBD | Lambda env vars are fetched from SSM at runtime |
| D-11 | Does ministack support KMS key creation? | TBD | DynamoDB + S3 encryption uses a CMK |

### Important (workaround possible if unsupported)

| # | Question | Answer | Notes |
|---|----------|--------|-------|
| D-12 | Does ministack require a different `AWS_ENDPOINT_URL` format? | TBD | Affects `.env.dev` and Lambda env vars |
| D-13 | Does ministack use the same AWS CLI command syntax? | TBD | `setup.sh` uses `awslocal` / `aws --endpoint-url` extensively |
| D-14 | Does ministack support the `awslocal` CLI wrapper? | TBD | `setup.sh` calls `awslocal` throughout — may need to replace with `aws --endpoint-url=<ministack>` |
| D-15 | Does ministack require a different Lambda invocation model? | TBD | Opt2 uses LocalStack container exec; opt3 uses SAM CLI — determine if SAM still works |
| D-16 | Does ministack support Docker network DNS (`ministack:port` hostname)? | TBD | Required for opt2-style container-to-container Lambda → service calls |
| D-17 | Does ministack support S3 bucket lifecycle rules? | TBD | Used for 3-day uploads TTL and 30-day processed TTL |
| D-18 | Does ministack support S3 bucket versioning? | TBD | Enabled on all 5 buckets |

### Nice-to-have (out of scope for initial migration)

| # | Question | Answer |
|---|----------|--------|
| D-19 | Does ministack support Textract? | TBD |
| D-20 | Does ministack support Bedrock? | TBD |
| D-21 | Does ministack support ElastiCache/Redis? | TBD |
| D-22 | Does ministack support WebSocket API Gateway @connections push? | TBD |

---

## 4. Service Parity Checklist

Once ministack tool is confirmed, check each LocalStack service against ministack support:

### Data Layer
- [ ] DynamoDB table with pk/sk schema
- [ ] DynamoDB GSI1 (hash: gsi1pk, range: gsi1sk)
- [ ] DynamoDB GSI2 (hash: gsi2pk, range: gsi2sk)
- [ ] DynamoDB GSI3 / ReceiptHashIndex (hash: gsi3pk, range: gsi3sk)
- [ ] DynamoDB TTL attribute
- [ ] DynamoDB KMS encryption
- [ ] DynamoDB Point-In-Time Recovery
- [ ] DynamoDB TransactWrite (all-or-nothing writes)
- [ ] DynamoDB second table (connections table — pk/sk only)

### Storage
- [ ] S3 bucket creation (5 buckets)
- [ ] S3 bucket versioning
- [ ] S3 bucket KMS server-side encryption
- [ ] S3 bucket CORS for `http://localhost:3000`
- [ ] S3 lifecycle rules (3-day for uploads, 30-day for processed)
- [ ] S3 presigned POST URLs
- [ ] S3 presigned GET URLs

### Messaging
- [ ] SQS standard queue (scan-dlq, scan-queue, ws-notifier-dlq)
- [ ] SQS FIFO queue with content-based deduplication (notifications.fifo)
- [ ] SQS Dead Letter Queue attachment
- [ ] SNS topic creation (textract-completion, alarms)
- [ ] SNS → SQS subscription
- [ ] EventBridge custom event bus
- [ ] EventBridge rule with event pattern filter
- [ ] EventBridge → Lambda target

### Auth & Config
- [ ] SSM Parameter Store SecureString creation
- [ ] SSM Parameter Store GetParameter at runtime
- [ ] KMS key creation with alias
- [ ] KMS GenerateDataKey / Decrypt (used by DynamoDB + S3)

---

## 5. File-by-File Migration Checklist

For each file, what changes when switching to ministack:

### `infrastructure/docker-compose.localstack.yml`
- [ ] Replace `localstack/localstack:3.5` image with ministack image
- [ ] Update port mapping if ministack uses a different port
- [ ] Update `AWS_ENDPOINT_URL` environment variable in service definitions
- [ ] Assess whether `cognito-local` sidecar is still needed (ministack may include Cognito)
- [ ] Update Docker network name if ministack requires a specific network
- [ ] Update health check URL to ministack health endpoint

### `infrastructure/localstack/dev/setup.sh`
- [ ] Replace `awslocal` with `aws --endpoint-url=<ministack-endpoint>` throughout (or update `awslocal` to point to ministack)
- [ ] Update endpoint URL variable at top of script
- [ ] Test each AWS CLI command against ministack for syntax compatibility
- [ ] Verify KMS key creation syntax is supported
- [ ] Verify DynamoDB GSI creation syntax matches ministack requirements
- [ ] Verify S3 CORS configuration format is compatible
- [ ] Verify EventBridge rule creation is supported

### `infrastructure/localstack/opt2/bootstrap.sh`
- [ ] Update Lambda endpoint URL for ministack
- [ ] Update API GW creation commands if syntax differs
- [ ] Verify Lambda function creation + update workflow is supported
- [ ] Update `enable-cors.sh` if API GW resource management differs

### `infrastructure/sam/template-arm.yaml` and `template-x64.yaml`
- [ ] Determine if SAM CLI works against ministack endpoint (most likely yes if ministack exposes standard AWS SDK endpoint)
- [ ] Update any LocalStack-specific SAM configuration
- [ ] Verify `--docker-network` flag still needed or if ministack resolves differently

### `setup/localstack.sh` (opt2 orchestrator)
- [ ] Replace LocalStack container name references with ministack container name
- [ ] Update health check URL
- [ ] Update `docker cp` commands if ministack container structure differs
- [ ] Update `docker exec` commands

### `setup/localstack-opt3.sh` (opt3 orchestrator)
- [ ] Update `AWS_ENDPOINT_URL` generation in env.json
- [ ] Update container health check
- [ ] Verify `--docker-network` flag for SAM against ministack
- [ ] Update SAM start command if endpoint flag differs

### `.env.dev`
- [ ] Update `AWS_ENDPOINT_URL=http://localhost:<ministack-port>`
- [ ] Update `AWS_ENDPOINT_URL` references for Lambda env injection

### `infrastructure/.env.test`
- [ ] Update `AWS_ENDPOINT_URL` to ministack endpoint for unit tests

### `CLAUDE.md`
- [ ] Update local dev commands section to reflect ministack
- [ ] Update option descriptions (opt2/opt3) if they change

### `README.md`
- [ ] Update "Three Local Stack Options" table
- [ ] Update architecture diagram references to LocalStack
- [ ] Update any `localstack` Docker image references

---

## 6. Parallel Running Strategy

To migrate without breaking the existing setup, run ministack alongside LocalStack on different ports during the transition:

```yaml
# docker-compose.migration.yml (temporary — delete after migration complete)
services:
  ministack:
    image: <ministack-image>:<version>
    ports:
      - "5566:5566"   # different port from LocalStack's 4566
    environment:
      AWS_DEFAULT_REGION: us-east-1

  localstack:
    image: localstack/localstack:3.5
    ports:
      - "4566:4566"   # unchanged — existing tests keep working
```

**Migration strategy:**
1. Start both containers
2. Run `setup.sh` against ministack endpoint (port 5566) in parallel
3. Run `backend/npm run test:ig` against ministack endpoint — if passing, service is migrated
4. Once all services verified: remove LocalStack from compose file, rename ministack to the standard port 4566 (or update `AWS_ENDPOINT_URL`)
5. Delete `docker-compose.migration.yml`

**Branch:** do all migration work on `feat/localstack/migrate-to-ministack` — never on main until all integration tests pass.

---

## 7. Rollback Procedure

If ministack fails parity checks mid-migration:

```bash
# Option A: revert specific files
git checkout main -- infrastructure/docker-compose.localstack.yml
git checkout main -- infrastructure/localstack/dev/setup.sh
git checkout main -- setup/localstack-opt3.sh
git checkout main -- .env.dev

# Option B: abandon migration branch entirely
git checkout main
git branch -D feat/localstack/migrate-to-ministack
```

LocalStack is fully operational until the migration branch is merged — rollback has zero downtime.

---

## 8. Verification (Post-Migration)

Run this full suite against ministack before merging:

```bash
# 1. Start ministack
docker compose up -d   # (post-migration compose file)

# 2. Seed data
bash infrastructure/localstack/dev/setup.sh

# 3. Backend integration tests (full suite)
cd backend && npm run test:ig

# 4. Infrastructure LocalStack tests
cd infrastructure && npm test

# 5. Opt3 smoke test
npm run dev:opt3
curl http://localhost:3001/health  # expect {"status":"ok"}
curl http://localhost:3001/groups  # expect non-500

# 6. Receipt upload flow (manual)
# Upload a test file via the frontend scan modal
# Confirm the presigned URL is generated and the file lands in the uploads bucket
```

All tests must pass before merging the migration branch.

---

## 9. Post-Migration Updates

After successful migration, update:
- `ai/agents/localstack-agent.md` — replace LocalStack specifics with ministack specifics in §3 (service inventory) and §5 (gotchas)
- `ai/skills/SKILLS.md` — update local dev commands in §5
- `notes/YYYY-MM-DD-ministack-migration.md` — migration troubleshooting summary
- `changelog/YYYY-MM-DD.md` — record the migration
