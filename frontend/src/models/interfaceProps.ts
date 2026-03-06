// ─── CostsCrunch — Component Prop Interfaces ─────────────────────────────────
// All React component prop types in one place.
// Domain models live in ./types.ts — import from there, not from backend.

import type { Expense } from "./types";

// ─── Component Props ──────────────────────────────────────────────────────────

export interface DonutChartProps {
  data: Array<{ label: string; value: number; color: string }>;
}

export interface ExpenseRowProps {
  expense: Expense;
  delay?: number;
}

export interface ScanModalProps {
  onClose: () => void;
  /** Receives a fully-shaped Expense (minus id, which the store assigns). */
  onAdd: (expense: Omit<Expense, "id">) => void;
}

export interface SideBarProps {
  activeTab: string;
  onTabChange: (id: string) => void;
  pendingCount: number;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  delay?: number;
}

export interface TopBarProps {
  activeTab: string;
  onScan: () => void;
  onAdd: () => void;
}

// ─── Store / Hook Shapes ──────────────────────────────────────────────────────

export interface ExpenseStoreState {
  expenses: Expense[];
  pending: Expense[];
  myExpenses: Expense[];
  filtered: Expense[];
  filter: string;
  search: string;
  addExpense: (expense: Omit<Expense, "id">) => void;
  setFilter: (filter: string) => void;
  setSearch: (search: string) => void;
}

// ─── Constants / Config Shapes ────────────────────────────────────────────────

export interface CategoryMeta {
  icon: string;
  color: string;
}

export interface NavItem {
  id: string;
  icon: string;
  label: string;
}

export interface SettingsItem {
  label: string;
  value: string;
}

export interface SettingsSection {
  title: string;
  items: SettingsItem[];
}