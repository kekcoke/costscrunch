export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
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
  currency: string;
  exchangeRate?: number;
  amountUSD: number;
  category: string;
  subcategory?: string;
  tags: string[];
  date: string;

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
  updatedAt: string;
  source: ExpenseSource;
}