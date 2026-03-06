// ─── CostsCrunch — Shared Domain Types ───────────────────────────────────────
// Single source of truth for all domain models used across frontend.
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
  groupId?: string; // Group context (null for personal)
  merchant: string;
  description?: string;
  amount: number;
  currency: string;  // ISO-4217: "USD", "EUR", etc.
  exchangeRate?: number;
  amountUSD: number;
  category: string;
  subcategory?: string;
  tags: string[];
  date: string; // ISO-8601 date string: "YYYY-MM-DD"

  /** Workflow timestamps */
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  reimbursedAt?: string;

  /** Approval workflow */
  status: ExpenseStatus;
  approverId?: string;
  approverNote?: string;

  /** Receipt info */
  receipt: boolean;
  receiptKey?: string;
  receiptUrl?: string;

  /** Group splitting */
  splits?: Split[];
  splitMethod?: string;

  /** Business metadata */
  projectCode?: string;
  costCenter?: string;
  billable?: boolean;
  reimbursable?: boolean;

  /** Policy flags */
  policyViolation?: string;

  /** Metadata */
  createdAt: string;
  updatedAt?: string;
  source: ExpenseSource;
  addedBy?: string;
  notes?: string;
}

export interface Group {
  id: string;
  name: string;
  members: number;
  total: number;
  myShare: number;
  color: string;         // hex color for UI
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
  currency?: string;
  notes?: string;
  group?: string | null;
  receipt?: boolean;
}

export interface GetExpensesQuery {
  status?: ExpenseStatus;
  category?: CategoryName;
  groupId?: string;
  search?: string;
  from?: string;
  to?: string;
  nextToken?: string;
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