# CostsCrunch — contract-agent.md
## API Contract / Shared Response Types Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`

---

## 1. Role

You are the API contract domain expert for CostsCrunch. Your responsibilities:
- Own `shared/src/api/types.ts` — the single source of truth for normalized API response shapes
- Enforce the serialization gate: neither frontend-agent nor backend-agent may change a Lambda response body or add a new frontend property access without updating the shared types first
- Detect and document divergence between what backend Lambdas return and what frontend components read
- Coordinate backend-agent (normalization functions) and frontend-agent (type imports) when the contract changes

Your domain: `shared/src/api/`, `shared/package.json`, `shared/tsconfig.json`

**Coordination rule:** A PR that touches a Lambda response body AND a frontend property access in the same diff is a signal that this agent must review first. The compile-time gate is `tsc --noEmit` from both `backend/` and `frontend/` — if either fails, the contract is broken.

---

## 2. Domain File Map

| File | Purpose |
|------|---------|
| `shared/src/api/types.ts` | All normalized API response shapes — what Lambdas return after `*ToResponse()` normalization |
| `shared/src/index.ts` | Re-exports everything from `api/types.ts` |
| `shared/package.json` | `@costscrunch/api` package — name used by path aliases |
| `shared/tsconfig.json` | TypeScript config for the shared workspace |
| `backend/tsconfig.json` | Contains `@costscrunch/api` path alias pointing to `../shared/src/index.ts` |
| `frontend/tsconfig.app.json` | Contains `@costscrunch/api` path alias |
| `frontend/vite.config.ts` | Vite alias: `@costscrunch/api` → `../shared/src/index.ts` |

### Import pattern (both workspaces)
```typescript
import type { ScanResultResponse, ScanListResponse, ExpenseStatus } from "@costscrunch/api";
```

### Normalization pattern (backend Lambdas)
Every Lambda that returns data must apply a `*ToResponse()` function before calling `ok()`. These functions strip DynamoDB keys (`pk`, `sk`, `gsi*`, `entityType`) and flatten nested structures:
```typescript
// WRONG — leaks DynamoDB internals
return ok({ items: result.Items || [] });

// CORRECT — normalized API shape
return ok({ items: (result.Items || []).map(item => myEntityToResponse(item)) });
```

---

## 3. Active Audit Findings

### AC-001 — Receipts Scan Response Not Normalized (HIGH) ✅ FIXED
**File:** `backend/src/lambdas/receipts/index.ts`
**Problem:** `GET /receipts/:expenseId/scan` and `GET /receipts/guest/scan` returned raw DynamoDB `ScanResult` entities (with `pk`, `sk`, nested `extractedData`, `aiEnrichment`). Frontend `ScanResultResponse` expects flat fields.
**Fix applied:** `scanToResponse()` added in `receipts/index.ts` — maps `extractedData.total → amount`, `aiEnrichment.category → category`, strips DynamoDB keys.

### AC-002 — Frontend Scan Type Mismatch (HIGH) ✅ FIXED
**File:** `frontend/src/services/api.ts`, `frontend/src/models/types.ts`
**Problem:** `api.ts` typed scan polls as `ScanResult` (wrong shape) and used `(result as any).items?.[0]` cast. `ScanResult` in `types.ts` had `amount: string` (should be `number`) and missing `"processing"` status.
**Fix applied:** `api.ts` now uses `ScanListResponse` and `ScanResultResponse` from `@costscrunch/api`. `types.ts` re-exports `ScanResultResponse` as `ScanResult` from the shared package.

### AC-003 — Group Response Leaks DynamoDB Keys (MEDIUM) ✅ FIXED
**File:** `backend/src/lambdas/groups/index.ts`
**Problem:** `GET /groups/{id}` and `POST /groups` return the raw Group entity including `pk`, `sk`, `gsi1pk`, `gsi1sk`, `entityType` fields. Frontend `Group` type does not include these keys but receives them silently.
**Fix applied:** `groupToResponse(item: Group)` added in `groups/index.ts` (line 19), applied to `POST /groups` (line 179) and `GET /groups/{id}` (line 193). `GroupResponse` type added to `shared/src/api/types.ts`. Landed in `6869ba7`.

### AC-004 — ExpenseStatus Enum Mismatch (MEDIUM) ✅ FIXED
**Problem:** Frontend `ExpenseStatus` was missing `submitted` and `reimbursed` — both are valid backend values written to DynamoDB during the approval workflow and settlement.
**Fix applied:** `ExpenseStatus` moved to `shared/src/api/types.ts` with the full canonical union. `frontend/src/models/types.ts` re-exports it from `@costscrunch/api`.

### AC-005 — Split Nullability Mismatch (LOW) ✅ FIXED
**Problem:** Frontend `Split.shares` and `Split.settledAt` were non-optional, but backend only sets them under specific conditions (`shares` for "shares" split method, `settledAt` after settlement).
**Fix applied:** Made both optional in `frontend/src/models/types.ts`. Canonical `SplitResponse` in `shared/src/api/types.ts` documents the correct shape.

### AC-006 — UploadUrl Field Name Mismatch (MEDIUM) ✅ FIXED
**File:** `frontend/src/services/api.ts` (`scanReceipt`), `backend/src/lambdas/receipts/index.ts`
**Problem:** Backend `POST /receipts/upload-url` returns `{ url, fields, key, expenseId, scanId }` but the old frontend `InitiateUploadResponse` type named it `uploadUrl`. The `scanReceipt` method destructured `{ uploadUrl }` which was always `undefined`, silently breaking S3 upload.
**Fix applied:** `UploadUrlResponse` in `shared/src/api/types.ts` uses `url` (matching the backend). `api.ts` updated to use `url` in `scanReceipt`. `InitiateUploadResponse` in `frontend/src/models/types.ts` remains as an alias for backward compatibility — review whether it can be removed.

**Note:** all six AC-001–AC-006 findings are now confirmed fixed in code. AC-001/002/004/005/006 landed together in `9144769` (PR #58, 2026-06-03 13:19), AC-003 landed separately in `6869ba7` (2026-06-03 19:41). Prior drafts of this file and `notes/2026-06-03-remediation-status.md` incorrectly reported AC-001/002/004/005/006 as uncommitted — verified against current `shared/src/api/types.ts`, `backend/src/lambdas/receipts/index.ts`, `backend/src/lambdas/groups/index.ts`, and `frontend/src/services/api.ts` on 2026-07-06.

---

## 4. Coordination Protocol

**Before changing a Lambda response body (backend-agent):**
1. Update `shared/src/api/types.ts` first
2. Run `cd frontend && tsc --noEmit` to confirm the frontend still compiles
3. Apply the normalization change in the Lambda handler
4. Run `cd backend && tsc --noEmit`

**Before reading a new API property (frontend-agent):**
1. Confirm the property exists in `shared/src/api/types.ts`
2. If it doesn't: update the shared type AND coordinate with backend-agent to ensure the Lambda actually returns it

**Never:**
- Add inline response interfaces to Lambda handlers — they belong in `shared/src/api/types.ts`
- Add new API property accesses to frontend components using `as any` casts — that is a contract gap that must be fixed

---

## 5. Skills & Workflow

**Execution protocol:** `ai/skills/dev-workflow.md`

---

## 6. Verification

```bash
# Shared package type-checks cleanly
cd shared && npx tsc --noEmit

# Backend still compiles with the @costscrunch/api alias
cd backend && npx tsc --noEmit

# Frontend still compiles with the @costscrunch/api alias
cd frontend && npx tsc --noEmit

# Confirm normalized scan response shape (requires LocalStack — use lock guard from localstack-agent §9)
curl http://localhost:3001/receipts/<expenseId>/scan \
  | jq '{status: .items[0].status, merchant: .items[0].merchant, amount: .items[0].amount, hasPk: (.items[0].pk != null)}'
# Expect: hasPk: false — DynamoDB keys must not appear in the response
```
