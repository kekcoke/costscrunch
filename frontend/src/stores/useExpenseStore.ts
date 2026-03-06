// ─── SpendLens — Global State (Zustand) ──────────────────────────────────────
// Replaces useState({ expenses, filter, search, tab }) scattered in App.jsx.
// Wire the actions to real API calls (src/services/api.ts) when ready.

import { create } from "zustand";
import { MOCK_EXPENSES } from "../mocks/expenses";
import type { Expense } from "../models/types";
import { tempId } from "../helpers/utils";

type ExpenseFilter = "all" | "pending" | "approved" | "rejected";

interface ExpenseStore {
  // ── State ───────────────────────────────────────────
  expenses: Expense[];
  filter: ExpenseFilter;
  search: string;

  // ── Derived ─────────────────────────────────────────
  readonly pending: Expense[];
  readonly myExpenses: Expense[];
  readonly filtered: Expense[];

  // ── Actions ─────────────────────────────────────────
  addExpense: (expenseData: Omit<Expense, "id">) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  removeExpense: (id: string) => void;

  setFilter: (f: ExpenseFilter) => void;
  setSearch: (q: string) => void;
}

export const useExpenseStore = create<ExpenseStore>((set, get) => ({

  // ── State ──────────────────────────────────────────────────────────────────
  /** @type {Expense[]} */
  expenses: MOCK_EXPENSES as Expense[],

  /** @type {"all"|"pending"|"approved"|"rejected"} */
  filter: "all",

  /** @type {string} */
  search: "",

  // ── Derived (computed inline to keep things simple without selectors lib) ──
  get pending() {
    return get().expenses.filter((e) => e.status === "pending");
  },

  get myExpenses() {
    return get().expenses.filter((e) => e.addedBy === "You");
  },

  get filtered() {
    const { expenses, filter, search } = get();
    return expenses.filter((e) => {
      const matchFilter =
        filter === "all" || e.status === filter;
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        e.merchant.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  /**
   * Optimistically add a new expense.
   * Replace the body with an API call + rollback on error.
   * @param {Omit<Expense, "id">} expenseData
   */
  addExpense: (expenseData) =>
    set((state) => ({
      expenses: [{ ...expenseData, id: tempId() }, ...state.expenses],
    })),

  /**
   * Update a single expense by id.
   * @param {string} id
   * @param {Partial<Expense>} patch
   */
  updateExpense: (id, patch) =>
    set((state) => ({
      expenses: state.expenses.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    })),

  /**
   * Remove an expense by id.
   * @param {string} id
   */
  removeExpense: (id) =>
    set((state) => ({
      expenses: state.expenses.filter((e) => e.id !== id),
    })),

  /** @param {"all"|"pending"|"approved"|"rejected"} f */
  setFilter: (f) => set({ filter: f }),

  /** @param {string} q */
  setSearch: (q) => set({ search: q }),
}));