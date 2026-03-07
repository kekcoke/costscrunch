// ─── CostsCrunch — Shared Domain Types ───────────────────────────────────────
// Single source of truth for most domain models used across frontend.
// Backend should export matching types from backend/src/shared/models/types.ts.

export type ExpenseStatus = "approved" | "pending" | "rejected" | "draft";
export type CategoryName = "Groceries" | "Travel" | "Software" | "Meals" | "Office" | "Equipment" | "Other";
export type ExpenseSource = "manual" | "scan" | "bank_sync" | "api";

export interface Split {
  userId: string;
  amount: number;
  percentage?: number;
  shares: number;
  settledAt: string;
}

export interface Expense {
  id: string;
  ownerId: string;
  groupId?: string | null;       // Group context (null for personal)
  merchant: string;
  description?: string | null;
  amount: number;
  currency: string;              // ISO-4217: "USD", "EUR", etc.
  exchangeRate?: number;
  amountUSD: number;
  category: string;
  subcategory?: string | null;
  tags: string[];
  date: string;                  // ISO-8601 date string: "YYYY-MM-DD"

  /** Workflow timestamps */
  submittedAt?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  reimbursedAt?: string | null;

  /** Approval workflow */
  status: ExpenseStatus;
  approverId?: string | null;
  approverNote?: string | null;

  /** Receipt info */
  receipt: boolean;
  receiptKey?: string | null;
  receiptUrl?: string | null;

  /** Group splitting */
  splits?: Split[];
  splitMethod?: string | null;

  /** Business metadata */
  projectCode?: string | null;
  costCenter?: string | null;
  billable?: boolean;
  reimbursable?: boolean;

  /** Policy flags */
  policyViolation?: string | null;

  /** Metadata */
  createdAt: string;
  updatedAt?: string | null;
  source: ExpenseSource;
  addedBy?: string | null;
  notes?: string | null;
}

export interface Group {
  id: string;
  name: string;
  members: number;
  total: number;
  myShare: number;
  color: string;                 // hex color for UI
}

export interface ScanResult {
  merchant: string;
  amount: string;
  category: CategoryName;
  date: string;
  notes: string;
  confidence: number;
  status: "pending" | "completed" | "failed";
}

// ─── API Request / Response shapes ───────────────────────────────────────────

export interface CreateExpenseRequest {
  merchant: string;
  category: CategoryName;
  amount: number;
  date: string;
  currency?: string | null;
  notes?: string | null;
  group?: string | null;         // was `string | null | null` — duplicate null removed
  receipt?: boolean;
}

export interface GetExpensesQuery {
  status?: ExpenseStatus;
  category?: CategoryName;
  groupId?: string | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  nextToken?: string | null;
  limit?: number;
}

export interface ExpenseSummary {
  total: number;
  count: number;
  byCategory: Record<CategoryName, number>;
  byMonth: Record<string, number>;
}

export interface InitiateUploadResponse {
  uploadUrl: string;
  expenseId: string;
  scanId: string;
}