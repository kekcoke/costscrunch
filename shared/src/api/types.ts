// ─── CostsCrunch — Canonical API Response Types ───────────────────────────────
// Shared between frontend and backend. These are NORMALIZED shapes — not DynamoDB
// entity types (no pk, sk, gsi* fields). Backend Lambda handlers must apply a
// *ToResponse() normalization function before returning these shapes.
//
// Owned by: contract-agent (ai/agents/contract-agent.md)
// Coordination rule: any change to these types must be accompanied by a tsc --build
// from the monorepo root to confirm both workspaces still compile.

// ─── Expense ──────────────────────────────────────────────────────────────────

// Canonical enum — includes all values the backend may write to DynamoDB.
// Frontend components must handle all five values (e.g., in status badge rendering).
export type ExpenseStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "reimbursed";

// ─── Split ────────────────────────────────────────────────────────────────────

// shares and settledAt are optional: shares is only set for "shares" split method;
// settledAt is only set once the split has been marked settled.
export interface SplitResponse {
  userId: string;
  amount: number;
  percentage?: number;
  shares?: number;
  settledAt?: string;
}

// ─── Receipt Scanning ─────────────────────────────────────────────────────────

// Flat normalized shape returned by GET /receipts/:expenseId/scan and
// GET /receipts/guest/scan after scanToResponse() normalization.
// Do NOT read extractedData or aiEnrichment directly — those are DynamoDB internals.
export interface ScanResultResponse {
  scanId: string;
  expenseId: string;
  // "processing" is a valid status emitted while Textract is running.
  status: "pending" | "processing" | "completed" | "failed";
  merchant?: string;
  amount?: number;       // mapped from extractedData.total (stored as number, not string)
  date?: string;
  category?: string;
  confidence?: number;
  createdAt?: string;
}

// Response envelope for GET /receipts/:expenseId/scan
export interface ScanListResponse {
  items: ScanResultResponse[];
  count: number;
}

// Response shape for POST /receipts/upload-url (backend returns `url`, not `uploadUrl`)
export interface UploadUrlResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
  expenseId: string;
  scanId: string;
}

// ─── Group ────────────────────────────────────────────────────────────────────

export interface GroupMemberResponse {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
  totalSpend: number;
  balance: number;
}

export interface BudgetResponse {
  period: "monthly" | "quarterly" | "annual" | "trip";
  amount: number;
  currency: string;
  category?: string;
  alertAt: number;
  hardCap: boolean;
}

// Normalized shape returned by POST /groups and GET /groups/{id} after
// groupToResponse() strips DynamoDB keys (pk, sk, gsi1pk, gsi1sk, entityType).
export interface GroupResponse {
  groupId: string;
  name: string;
  description?: string;
  type: "personal" | "trip" | "household" | "business" | "project";
  ownerId: string;
  color: string;
  iconEmoji?: string;
  members: GroupMemberResponse[];
  memberCount: number;
  budgets: BudgetResponse[];
  currency: string;
  approvalRequired?: boolean;
  approvalThreshold?: number;
  requireReceipts?: boolean;
  requireReceiptsAbove?: number;
  policyId?: string;
  costCenters?: string[];
  projectCodes?: string[];
  totalSpend: number;
  monthSpend: number;
  expenseCount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
