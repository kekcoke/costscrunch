# CostsCrunch — add-frontend-component.md
## Skill: Add a React Component or Page

> Used by: frontend-agent

---

## 1. Stack Context

```
React 19 + Vite + React Router 7 + Zustand 5 + TanStack Query 5 + AWS Amplify Auth 6
```

File locations:
- Pages (route-level): `frontend/src/pages/`
- Reusable components: `frontend/src/components/`
- State stores: `frontend/src/stores/`
- API client: `frontend/src/services/api.ts`
- Types: `frontend/src/models/types.ts`, `frontend/src/models/interfaceProps.ts`

---

## 2. CSS Design Tokens

Always use tokens — never hardcode hex values:

```css
var(--color-bg)         /* page background */
var(--color-surface)    /* card / panel background */
var(--color-surface-2)  /* nested card / input background */
var(--color-border)     /* border color */
var(--color-text)       /* primary text */
var(--color-text-dim)   /* secondary / muted text */
var(--font-display)     /* heading font */
```

Accent colors (use for CTAs and active states only):
- `#6366f1` — indigo (primary)
- `#0ea5e9` — sky blue (secondary)

---

## 3. Component Pattern

```tsx
import { useExpenseStore } from '@src/stores/useExpenseStore';
import { api } from '@src/services/api';
import type { Expense } from '@src/models/types';

interface ExpenseCardProps {
  expenseId: string;
}

export function ExpenseCard({ expenseId }: ExpenseCardProps) {
  const expense = useExpenseStore(s => s.expenses.find(e => e.id === expenseId));

  if (!expense) return null;

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <h3 style={{ color: 'var(--color-text)' }}>{expense.merchant}</h3>
      <span style={{ color: 'var(--color-text-dim)' }}>{expense.category}</span>
    </div>
  );
}
```

---

## 4. State Synchronization Pattern

After any mutation (POST, PATCH, DELETE), update the Zustand store immediately — do not re-fetch the list:

```typescript
// CORRECT — immediate store update
try {
  const updated = await api.updateGroup(groupId, payload);
  useGroupStore.getState().updateGroup(groupId, updated);  // sync immediately
} catch (err) {
  handleError(err);
}

// WRONG — unnecessary re-fetch causes stale flash and double render
await api.updateGroup(groupId, payload);
await fetchGroups();  // BAD
```

This is critical for theme changes (color), name updates, and deletions — the UI must reflect changes without a round-trip.

**Store action pattern (in the Zustand store):**

```typescript
const useGroupStore = create<GroupStore>((set) => ({
  groups: [],
  updateGroup: (id, updates) =>
    set(s => ({ groups: s.groups.map(g => g.id === id ? { ...g, ...updates } : g) })),
  deleteGroup: (id) =>
    set(s => ({ groups: s.groups.filter(g => g.id !== id) })),
}));
```

---

## 5. Data Fetching

Prefer TanStack Query for server state. Use `staleTime` to prevent over-fetching:

```typescript
import { useQuery } from '@tanstack/react-query';
import { api } from '@src/services/api';

// GOOD — fetches once per route mount, not on every render
const { data: expenses, isLoading } = useQuery({
  queryKey: ['expenses', userId],
  queryFn: () => api.getExpenses(),
  staleTime: 30_000,                     // 30s before re-fetch
  enabled: !!userId,                     // only fetch when authenticated
});

// AVOID — useEffect fetch fires on every render unless deps are stable
useEffect(() => { fetchExpenses(); }, []);  // BAD: missing or wrong deps
```

---

## 6. Chart Switching

Use `startTransition` when switching chart types so the old chart stays visible during the transition:

```typescript
import { startTransition, useState } from 'react';

const [chartType, setChartType] = useState<'donut' | 'bar'>('donut');

function switchChart(type: typeof chartType) {
  startTransition(() => setChartType(type));  // old chart visible until new one is ready
}
```

---

## 7. Prompt Template

```
Create a [ComponentName] React component for CostsCrunch. It should [description].
Stack: React 19 + Zustand 5 + TanStack Query 5.
Use CSS custom properties (var(--color-bg), var(--color-surface), etc.) — no hardcoded hex.
Export from frontend/src/[pages|components]/.
After mutations, update the Zustand store immediately (no re-fetch).
Write a Vitest test in frontend/__tests__/components.test.tsx covering [scenarios].
Mock: api.ts methods with vi.fn(), recharts at module level, react-router-dom useNavigate.
```

---

## 8. Writing the Vitest Test

See `ai/skills/write-vitest-tests.md` for full mock patterns.

Quick template:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ExpenseCard } from '@src/components/expenseCard';

// Module-level mocks (before describe blocks)
vi.mock('@src/services/api', () => ({ api: { getExpenses: vi.fn().mockResolvedValue([]) } }));
vi.mock('recharts', () => ({ ResponsiveContainer: ({ children }: any) => <>{children}</> }));

describe('ExpenseCard', () => {
  it('renders expense merchant name', () => {
    render(<ExpenseCard expenseId="exp-001" />);
    expect(screen.getByText('Whole Foods')).toBeInTheDocument();
  });
});
```
