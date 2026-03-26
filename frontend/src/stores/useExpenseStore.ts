// ─── CostsCrunch — Global State (Zustand) ──────────────────────────────────────
// Replaces useState({ expenses, filter, search, tab }) scattered in App.jsx.
// Wire the actions to real API calls (src/services/api.ts) when ready.

import { create } from "zustand";
import { createSelector } from "reselect";

import { MOCK_EXPENSES } from "../mocks/expenses";
import type { Expense } from "../models/types";
import { expensesApi } from "../services/api";
import { tempId } from "../helpers/utils";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { shallow } from "zustand/shallow";

export type ExpenseFilter = "all" | "pending" | "approved" | "rejected";

interface ExpenseStore {
  // ── State ───────────────────────────────────────────
  expenses: Expense[];
  filter: ExpenseFilter;
  search: string;

  // ── Actions ─────────────────────────────────────────
  addExpense: (expenseData: Omit<Expense, "id">) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  removeExpense: (id: string) => void;
  fetchExpenses: () => Promise<void>;

  setFilter: (f: ExpenseFilter) => void;
  setSearch: (q: string) => void;
}

export const useExpenseStore = create<ExpenseStore>((set) => ({

  // ── State ──────────────────────────────────────────────────────────────────
  expenses: MOCK_EXPENSES as Expense[],
  filter: "all",
  search: "",

  // ── Actions ────────────────────────────────────────────────────────────────
  /**
   * Optimistically add a new expense.
   * Replace the body with an API call + rollback on error.
   * tempId() is called outside set() to keep the setter pure and
   * make the generated id available for rollback if needed.
   */
  addExpense: (expenseData) => {
    const id = tempId();
    set((state) => ({
      expenses: [{ ...expenseData, id }, ...state.expenses],
    }));
  },

  /**
   * Update a single expense by id.
   */
  updateExpense: (id, patch) =>
    set((state) => ({
      expenses: state.expenses.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    })),

  /**
   * Remove an expense by id.
   */
  removeExpense: (id) =>
    set((state) => ({
      expenses: state.expenses.filter((e) => e.id !== id),
    })),

  fetchExpenses: async () => {
    try {
      const { items } = await expensesApi.list();
      set({ expenses: items });
    } catch (err) {
      console.error("Failed to fetch expenses:", err);
    }
  },

  setFilter: (f) => set({ filter: f }),
  setSearch: (q) => set({ search: q }),
}));

// ─── Selectors ────────────────────────────────────────────────────────────────
// Use these in components instead of inline destructuring to avoid unnecessary
// re-renders. For single values, pass directly; for multiple values, wrap in
// an object selector and pass `shallow` as the equality function.
//
// Usage (single value):
//   const expenses = useExpenseStore(selectExpenses);
//
// Usage (multiple values — shallow prevents re-render if refs are unchanged):
//   const { filter, search } = useExpenseStore(selectControls, shallow);

export const selectExpenses = (s: ExpenseStore) => s.expenses;
export const selectFilter   = (s: ExpenseStore) => s.filter;
export const selectSearch   = (s: ExpenseStore) => s.search;

/** Pending expenses — stable reference when expenses haven't changed. */
export const selectPending = createSelector(
  (s: ExpenseStore) => s.expenses,
  (expenses) => expenses.filter((e) => e.status === "pending")
);

/** Expenses added by the current user. */
export const selectMyExpenses = createSelector(
  (s: ExpenseStore) => s.expenses,
  (expenses) => expenses.filter((e) => e.addedBy === "You")
);

/** Filter + search applied. Use with `shallow` if consumed alongside other selectors. */
export const selectFiltered = createSelector(
  (s: ExpenseStore) => s.expenses,
  (s: ExpenseStore) => s.filter,
  (s: ExpenseStore) => s.search,
  (expenses, filter, search) => {
    const q = search.toLowerCase();
    return expenses.filter((e) => {
      const matchFilter = filter === "all" || e.status === filter;
      const matchSearch =
        !q ||
        e.merchant.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }
);

/** Actions grouped — stable reference (Zustand never re-creates action fns). */
export const selectActions = (s: ExpenseStore) => ({
  addExpense:    s.addExpense,
  updateExpense: s.updateExpense,
  removeExpense: s.removeExpense,
  setFilter:     s.setFilter,
  setSearch:     s.setSearch,
});

// ─── Convenience hook for the full filter-bar state ───────────────────────────
// Bundles filter + search + their setters in one shallow-compared call so the
// filter bar only re-renders when these four values actually change.
//
// Usage:
//   const { filter, search, setFilter, setSearch } = useFilterControls();

export const useFilterControls = () =>
  useExpenseStoreEq(
    (s) => ({
      filter:    s.filter,
      search:    s.search,
      setFilter: s.setFilter,
      setSearch: s.setSearch,
    }),
  );

export const useExpenseStoreEq = <T>(
  selector: (state: ExpenseStore) => T
) => useStoreWithEqualityFn(useExpenseStore, selector, shallow);