// ─── CostsCrunch — Shared Domain Types ───────────────────────────────────────
// Single source of truth for most domain models used across frontend.
// API response shape types (scan results, upload URL) live in @costscrunch/api.

import type { ReactNode } from "react";
export type { ExpenseStatus, ScanResultResponse, SplitResponse, UploadUrlResponse } from "@costscrunch/api";

// ExpenseStatus is re-exported from @costscrunch/api (canonical: draft | submitted | approved | rejected | reimbursed)
export type CategoryName = "Groceries" | "Travel" | "Software" | "Meals" | "Office" | "Equipment" | "Other";
export type ExpenseSource = "manual" | "scan" | "bank_sync" | "api";

// Split.shares and Split.settledAt are optional — only present for "shares" split method
// and after settlement respectively. Matches backend SplitResponse from @costscrunch/api.
export interface Split {
  userId: string;
  amount: number;
  percentage?: number;
  shares?: number;
  settledAt?: string;
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

export interface GroupMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  totalSpend: number;
  balance: number;
}

export interface Group {
  groupId: string;
  name: string;
  description?: string;
  type: string;
  ownerId: string;
  color: string;
  members: GroupMember[];
  memberCount: number;
  totalSpend: number;
  monthSpend: number;
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
  // UI-specific computed fields if handled by store/mapper
  total: number; 
  myShare: number;
}

// ScanResult is an alias for ScanResultResponse from @costscrunch/api.
// Do not extend or duplicate here — update shared/src/api/types.ts instead.
export type { ScanResultResponse as ScanResult } from "@costscrunch/api";

export interface BalancesResponse {
  balances: Record<string, number>;
  settlements: Array<{ from: string; to: string; amount: number }>;
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

export interface ExpenseSummaryStats {
  totalAmount: number;
  expenseCount: number;
  avgPerExpense: number;
  topCategory: CategoryName;
  period: "week" | "month" | "quarter" | "year";
  currency: string;
}

export interface TrendBucket {
  period: string;
  total: number;
  categories: Record<string, number>;
}

export interface AnalyticsTrends {
  buckets: TrendBucket[];
}

export interface DonutChartDatum {
  label: string;
  value: number;
  color: string;
}

export interface HorizontalBarChartDatum {
  category: string;
  amount: number;
}

export interface BubbleChartDatum {
  date: string;
  amount: number;
  frequency: number;
  category: string;
}

export interface AnalyticsChartData {
  donut: DonutChartDatum[];
  horizontalBar: HorizontalBarChartDatum[];
  bubble: BubbleChartDatum[];
  stackedBar: TrendBucket[];
}

export interface AnalyticsQuery {
  period?: "week" | "month" | "quarter" | "year";
  categories?: string[];
  from?: string;
  to?: string;
  currency?: string;
  scope?: "personal" | "group" | "all";
  chartType?: "donut" | "horizontalBar" | "bubble" | "stackedBar";
}

export interface AnalyticsApiLike {
  summary: (query?: AnalyticsQuery) => Promise<ExpenseSummaryStats>;
  trends: (query?: AnalyticsQuery) => Promise<AnalyticsTrends>;
  chartData: (query?: AnalyticsQuery) => Promise<AnalyticsChartData>;
}

export interface InitiateUploadResponse {
  uploadUrl: string;
  expenseId: string;
  scanId: string;
}

export interface WsScanCompletedMessage {
  type:         "RECEIPT_SCAN_COMPLETED";
  expenseId:    string;
  scanId:       string;
  merchant?:    string;
  amount?:      number;
  category:     string;
  confidence:   number;
  processingMs: number;
  multiPage?:   boolean;
}

export interface WsQuarantineMessage {
  type:       "QUARANTINE";
  reason:     "unreadable" | "oversized" | "corrupt" | "unsupported_format";
  fileName:   string;
  message:    string;
  scannedAt:  string;
}

export interface WsMultiPageMessage {
  type:       "MULTI_PAGE";
  fileName:   string;
  pageCount:  number;
  message:    string;
}

export type WsMessage = WsScanCompletedMessage | WsQuarantineMessage | WsMultiPageMessage;

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  headerActions?: ReactNode;
  maxWidth?: string;
}