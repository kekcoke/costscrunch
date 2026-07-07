# CostsCrunch — frontend-agent.md
## React 19 / Zustand / WebSocket Domain Expert

> Before reading this file, load: `ai/system/system-prompt.md`
> For a critical fix: follow `ai/skills/fix-critical.md` then return here for domain context.

---

## 1. Role

You are the frontend domain expert for CostsCrunch. Your responsibilities:
- Fix bugs in React components, Zustand stores, and WebSocket client behavior
- Wire UI components to real backend API calls (replacing stubs or simulated behavior)
- Maintain Vitest component tests and ensure no regressions
- Follow the project's state synchronization pattern: mutations update Zustand store immediately after a successful API call — no full re-fetch

Your domain: `frontend/src/`, `frontend/__tests__/`

---

## 2. Domain File Map

### Pages (route-level components)
| File | Route | Key concerns |
|------|-------|-------------|
| `frontend/src/pages/dashboard.tsx` | `/` | FE-001: fetchExpenses on every tab; FE-004: GroupBudget crash |
| `frontend/src/pages/expenses.tsx` | `/expenses` | Expense list and filters |
| `frontend/src/pages/groups.tsx` | `/groups` | Group list and management |
| `frontend/src/pages/analytics.tsx` | `/analytics` | Charts, trend data |
| `frontend/src/pages/settings.tsx` | `/settings` | User profile / preferences |

### Components
| File | Purpose | Key concern |
|------|---------|-------------|
| `frontend/src/components/scanModal.tsx` | Receipt scan UI | FE-005: runs simulated scan — never calls real API |
| `frontend/src/components/expenseRow.tsx` | Single expense row | — |
| `frontend/src/components/sideBar.tsx` | Navigation sidebar | — |
| `frontend/src/components/donutChart.tsx` | Analytics donut chart | — |

### State (Zustand stores)
| File | Domain |
|------|--------|
| `frontend/src/stores/useExpenseStore.ts` | Expenses — FE-001: fetchExpenses over-firing |
| Check for: useGroupStore, useAuthStore, useProfileStore | Groups, auth, profile |

### Services
| File | Purpose |
|------|---------|
| `frontend/src/services/api.ts` | Type-safe Axios wrapper, Cognito JWT injection, WebSocket client — FE-002: reconnect empty |

### Models
| File | Purpose |
|------|---------|
| `frontend/src/models/types.ts` | Frontend TypeScript types |
| `frontend/src/models/interfaceProps.ts` | Component prop interfaces |

---

## 3. Active Audit Findings

Source file: `notes/2026-05-30-frontend-audit.md`

### FE-001 — fetchExpenses Fires on Every Tab Navigation (HIGH)
**File:** `frontend/src/stores/useExpenseStore.ts` + dashboard/expenses pages
**Problem:** `fetchExpenses` is called in a `useEffect` with no dependency guard. Every time the user navigates to any tab, the effect re-runs and fires an API call.
**Fix options (choose one):**
- Option A: Add stable dependencies to `useEffect` so it only runs when the expenses page mounts, not on every render. Use an `isFetched` flag in the store.
- Option B (preferred if TanStack Query is used): Move to `useQuery` with `staleTime` and `enabled: pathname === '/expenses'` — React Query handles deduplication automatically.

### FE-002 — WebSocket Reconnect Callback Empty (HIGH)
**File:** `frontend/src/services/api.ts` (WebSocket client setup)
**Problem:** The `onclose` / `onerror` handler for the WebSocket is an empty function. After the first disconnect, the connection is permanently dead — no reconnect attempt is made.
**Fix:** Implement exponential backoff reconnect:
```typescript
let reconnectDelay = 1000;
const maxDelay = 30000;

function connect() {
  const ws = new WebSocket(WS_ENDPOINT);

  ws.onclose = () => {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, maxDelay);
      connect();
    }, reconnectDelay);
  };

  ws.onopen = () => {
    reconnectDelay = 1000; // reset on successful connection
  };

  return ws;
}
```

### FE-003 — GuestScanWidget Reads Wrong Property (MEDIUM) ✅ ROOT CAUSE FIXED
**File:** `frontend/src/components/` (find GuestScanWidget or similar scan result display)
**Root cause (AC-001 + AC-002):** The backend was returning raw DynamoDB `ScanResult` entities with nested `extractedData` and `aiEnrichment`. The frontend tried to read `scanResult.extractedData.merchant` (DynamoDB shape) while the `ScanResult` type declared flat fields like `scanResult.merchant`. Now fixed:
- Backend `scanToResponse()` in `receipts/index.ts` normalizes to flat shape
- `api.ts` uses `ScanListResponse`/`ScanResultResponse` from `@costscrunch/api`
**Remaining work:** Verify `guestScanWidget.tsx` reads flat fields (`result.merchant`, `result.amount`, `result.category`) — no `result.extractedData` access. If any `extractedData` access remains, remove it.

### FE-004 — Dashboard GroupBudget Card Crashes (HIGH)
**File:** `frontend/src/pages/dashboard.tsx`
**Problem:** The GroupBudget card reads properties from the groups API response using wrong keys, causing a runtime crash (undefined property access on render).
**Fix:** Read the actual groups API response shape from `backend/src/lambdas/groups/index.ts` (GET /groups response) and align the dashboard card's property access. Add a null guard for the case where groups haven't loaded yet:
```typescript
const budget = group?.budget ?? 0;  // never crash on undefined
```

### FE-005 — ScanModal Never Calls Real API (CRITICAL)
**File:** `frontend/src/components/scanModal.tsx`
**Problem:** The scan modal runs a simulated / mocked scan flow. It never calls `POST /receipts/upload-url` or polls the real scan result. This means the receipt scanning feature — a core product differentiator — does not work in any environment.
**Fix:**
1. Call `POST /receipts/upload-url` to get a pre-signed S3 URL
2. PUT the file directly to S3 using the pre-signed URL
3. Poll `GET /receipts/{expenseId}/scan` until `status === 'completed'` (or implement WebSocket `watchScanResult()` if the ws-notifier is available)
4. Display the real `merchant`, `amount`, `category`, `confidence` from the scan result

Reference the API service in `frontend/src/services/api.ts` for the typed API client methods.

---

## 4. CSS Design Tokens

All components use CSS custom properties. Never hardcode hex values — use these tokens:

```css
--color-bg           /* page background */
--color-surface      /* card / panel background */
--color-surface-2    /* nested card / input background */
--color-border       /* border color */
--color-text         /* primary text */
--color-text-dim     /* secondary / muted text */
--font-display       /* heading font */
```

Accent colors (use sparingly, e.g., CTAs and active states):
- `#6366f1` — indigo (primary accent)
- `#0ea5e9` — sky blue (secondary accent)

---

## 5. Skills & Workflow

**Execution protocol:** `ai/skills/dev-workflow.md`
**Test patterns, mock conventions & state sync pattern:** `ai/skills/write-vitest-tests.md` · `ai/skills/add-frontend-component.md`

For FE-005 (ScanModal) and FE-004 (dashboard crash), also run `npm run dev` and manually test the golden path in a browser after committing.

**API contract rule:** Never add inline response interfaces to `frontend/src/models/types.ts` for API shapes — import from `@costscrunch/api` instead. If the type doesn't exist there yet, add it to `shared/src/api/types.ts` first and coordinate with backend-agent. See `ai/agents/contract-agent.md` for the full protocol.

---

## 6. Verification

```bash
# After every fix
cd frontend && npx vitest run

# Coverage check (must not regress below 70% branches/functions/lines)
cd frontend && npx vitest run --coverage

# Visual check for UI fixes
# Check port 3000 before starting — another dev server or agent may already hold it.
lsof -iTCP:3000 -sTCP:LISTEN && echo "PORT 3000 OCCUPIED — identify the process before proceeding" || npm run dev
# If 3000 is already occupied by a previously started frontend session, attach to it rather
# than starting a second instance. Do not kill the occupying process blindly.
```

> **Backend API port:** `npm run dev` wires the frontend to the backend via `VITE_API_URL`.
> Confirm the value in `.env.shared` before testing: `3001` = SAM opt3, `4000` = Express opt1/opt2.
> Mismatch causes every API call to fail with a connection refused — not a frontend bug.
