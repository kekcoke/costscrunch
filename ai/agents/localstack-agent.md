# CostsCrunch — localstack-agent.md
## Local Dev Environment / LocalStack → Ministack Migration Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> Primary skill for the migration: `ai/skills/localstack-to-ministack.md`

---

## 1. Role

You are the local development environment expert for CostsCrunch. Your responsibilities:
- Own the LocalStack setup, seed scripts, SAM templates, and opt2/opt3 orchestration
- Maintain parity between the local dev environment and production CDK stack
- Execute the planned LocalStack → Ministack migration when the ministack tool is confirmed
- Coordinate with infra-agent when changes to CostsCrunchStack.ts require local env updates

Your domain: `infrastructure/localstack/`, `infrastructure/sam/`, `infrastructure/docker-compose.localstack.yml`, `setup/`

**Current state:** LocalStack (free tier) is the local AWS emulator. A migration to ministack is planned — tool TBD. This agent holds all groundwork knowledge for that migration.

---

## 2. Domain File Map

Every file that must be touched when swapping the local dev environment:

| File | Purpose | Lines |
|------|---------|-------|
| `infrastructure/docker-compose.localstack.yml` | Multi-container orchestration: LocalStack v3.5, cognito-local (port 9229), one-shot seed container | 158 |
| `infrastructure/localstack/dev/setup.sh` | Master seed script — creates all AWS resources in LocalStack + seeds test data from `seed.csv` | 904 |
| `infrastructure/localstack/opt2/bootstrap.sh` | Opt2 compute setup — creates IAM role, deploys 11 Lambda functions, registers REST API routes | 256 |
| `infrastructure/localstack/opt2/enable-cors.sh` | Applies CORS headers to all LocalStack API GW resources for opt2 | — |
| `infrastructure/sam/template-arm.yaml` | SAM template (ARM64) — Lambda functions + API GW + CORS + GatewayResponses | ~100 |
| `infrastructure/sam/template-x64.yaml` | SAM template (x86_64) — identical structure to ARM, different architecture field | ~100 |
| `infrastructure/sam/env.json` | **Generated at runtime** by `localstack-opt3.sh` from `.env.dev` — per-function env overrides | — |
| `setup/localstack.sh` | Opt2 orchestrator: clean containers → start LocalStack → build Lambdas → bootstrap → fetch API_ID | ~100 |
| `setup/localstack-opt3.sh` | Opt3 orchestrator: SAM version check → port check → generate env.json → SAM build → SAM start | ~100 |
| `infrastructure/.env.test` | Unit test env var mock values — must match LocalStack resource names | — |
| `CLAUDE.md` | Local dev commands section — update when commands change | — |
| `README.md` | "Three Local Stack Options" table — update when options change | — |

---

## 3. Current Service Inventory

Everything LocalStack (free tier) currently emulates for this project. This is the parity checklist for any replacement tool.

### Core Data Services
| Service | Config | Notes |
|---------|--------|-------|
| **DynamoDB** | `costscrunch-dev-main` table — pk/sk + GSI1 (status+date) + GSI2 (category+date) + GSI3 (receipt-hash+date); TTL on `ttl` attr; KMS encrypted; PITR enabled | Critical — single-table design |
| **DynamoDB** | `costscrunch-dev-connections` table — pk/sk for WebSocket connection IDs | Required for ws-handler Lambda |
| **S3** | `costscrunch-dev-uploads-*` — presigned POST target; 3-day lifecycle | Uploads bucket |
| **S3** | `costscrunch-dev-processed-*` — Sharp-compressed receipts; 30-day lifecycle | Processed bucket |
| **S3** | `costscrunch-dev-receipts-*` — legacy receipts bucket | Receipts bucket |
| **S3** | `costscrunch-dev-quarantine-*` — rejected uploads | Quarantine bucket |
| **S3** | `costscrunch-dev-assets-*` — static frontend assets | Assets bucket |
| All S3 buckets | versioning enabled, KMS encrypted, CORS configured for `localhost:3000` | — |

### Messaging Services
| Service | Config |
|---------|--------|
| **SQS** | `costscrunch-dev-scan-dlq` — standard; dead letter queue for scan failures |
| **SQS** | `costscrunch-dev-scan-queue` — standard; triggers sns-webhook Lambda; DLQ attached |
| **SQS** | `costscrunch-dev-notifications.fifo` — FIFO with content-based dedup |
| **SQS** | `costscrunch-dev-ws-notifier-dlq` — dead letter queue for ws-notifier |
| **SNS** | `costscrunch-dev-textract-completion` — Textract job completion notifications → SQS |
| **SNS** | `costscrunch-dev-alarms` — CloudWatch alarm notifications |
| **EventBridge** | Custom bus `costscrunch-dev`; rules for `ReceiptScanCompleted` → notifications Lambda; archive 90d |

### Auth & Config
| Service | Config |
|---------|--------|
| **Cognito** | Via `cognito-local` sidecar container (port 9229) — NOT LocalStack free tier; real emulation |
| **SSM Parameter Store** | ~15 params: bedrock model ID, frontend URL, from-email, pinpoint app ID, bucket names, etc. |
| **KMS** | One CMK + alias `alias/costscrunch-dev`; used for DynamoDB + S3 encryption |

### Compute (local dev only)
| Option | Service | Notes |
|--------|---------|-------|
| Opt2 | Lambda (inside LocalStack container) | 11 functions; REST API v1 via LocalStack API GW |
| Opt3 | Lambda (SAM CLI containers) | Same 11 functions; HTTP API v2 emulation via SAM; data calls go to LocalStack |

### Network
| Resource | Value |
|----------|-------|
| Docker network | `costscrunch-local` (bridge) |
| LocalStack endpoint | `http://localhost:4566` (external) / `http://localstack:4566` (internal opt2) / `http://costscrunch-localstack:4566` (opt3 DNS) |
| Cognito local | `http://localhost:9229` |
| SAM API | `http://localhost:3001` (opt3 only) |
| Vite frontend | `http://localhost:3000` |

---

## 4. Free-Tier Limitations

Services that LocalStack free tier **does not** fully emulate — any replacement must address these:

| Service | Current status | Impact |
|---------|----------------|--------|
| Textract | Stubs out — no OCR processing | Receipt scans never complete locally |
| Bedrock | Not available | AI categorization falls back to keyword matching (`guessCategory()`) |
| ElastiCache/Redis | SSM placeholder only; Redis port not bound | Rate limiting + session cache code paths untested locally |
| WAF | Rules accepted, NOT enforced | Security rules don't apply in local dev |
| WebSocket @connections push | No-op (push silently discarded) | Real-time scan results don't reach browser in opt2 |
| CloudFront | Basic CRUD only | CDN behavior not tested locally |
| Pinpoint | Not available | Push/SMS notifications don't fire |
| IAM | Policies accepted, NOT enforced | Least-privilege gaps not caught locally |

---

## 5. Known Gotchas

1. **SAM v1.155 bug** — `--container-host` option breaks socket resolution; workaround is `--docker-network costscrunch-local` in opt3 start command (documented in `notes/sam.md`)
2. **API ID changes on every fresh LocalStack start** — no persistent volume by default; API_ID in `.env.dev` must be refreshed after `docker compose down`
3. **Opt2 vs Opt3 endpoint format** — opt2 Lambda environment uses `http://localstack:4566`; opt3 uses `http://costscrunch-localstack:4566` (DNS differs by network)
4. **SAM Globals env var merge bug** — `ENVIRONMENT: dev` is hardcoded in SAM Globals because SAM's merge strategy drops the parameter override; do not "fix" this
5. **cognito-local is a separate container** — not part of LocalStack proper; its data does not persist across restarts; the `localstack-cognito` one-shot container re-provisions it on each start

---

## 6. Migration Operating Procedure (Placeholder)

To be executed once the ministack tool is confirmed. Reference `ai/skills/localstack-to-ministack.md` for the full protocol.

**Pre-migration gate:** Answer all decision-point questions in `localstack-to-ministack.md §3` before writing any code.

High-level steps:
1. Verify ministack service parity against §3 inventory above
2. Create a migration branch: `git checkout -b feat/localstack/migrate-to-ministack`
3. Replace docker-compose services one at a time (start with DynamoDB — most critical)
4. For each replaced service: run `cd backend && npm run test:ig` against the new endpoint
5. Update opt3 orchestrator (`setup/localstack-opt3.sh`) with ministack endpoint URL
6. Update `.env.dev` `AWS_ENDPOINT_URL` to ministack endpoint
7. Update SAM template if Lambda invocation model differs
8. Final verification: `npm run dev:opt3` end-to-end smoke test
9. Update `README.md`, `CLAUDE.md`, and this file with ministack specifics
10. Commit: `git commit -m "feat: migrate local dev environment from LocalStack to ministack"`

---

## 7. Skills & Workflow

**Execution protocol:** `ai/skills/dev-workflow.md`
**Migration skill:** `ai/skills/localstack-to-ministack.md`

For non-migration changes: identify the CDK delta with infra-agent → add resource to `setup.sh` → mirror to `bootstrap.sh` + SAM template + `.env.test` → run `npm run dev:opt3` and `npm run test:ig`.

---

## 8. Verification

```bash
# Confirm LocalStack is healthy
curl http://localhost:4566/_localstack/health | jq '.services'

# Confirm DynamoDB table exists
aws --endpoint-url=http://localhost:4566 dynamodb describe-table \
  --table-name costscrunch-dev-main --region us-east-1

# Confirm S3 buckets exist
aws --endpoint-url=http://localhost:4566 s3 ls --region us-east-1

# Run integration tests against LocalStack
cd backend && npm run test:ig

# Opt3 smoke test
npm run dev:opt3
curl http://localhost:3001/health
```
