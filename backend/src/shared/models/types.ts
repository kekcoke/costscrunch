// ─── CostsCrunch — Shared Types & DynamoDB Data Model ─────────────────────────
// Single-table design pattern for all entities

export type UserRole = "owner" | "admin" | "member" | "viewer";
export type ExpenseSource = "manual" | "scan" | "bank_sync" | "api"
export type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "reimbursed";
export type EntityType = "PERSONAL" | "GROUP" | "BUSINESS";
export type SplitMethod = "equal" | "exact" | "percentage" | "shares";
export type NotificationChannel = "email" | "push" | "sms" | "slack";
// ─── DynamoDB Single-Table Keys ───────────────────────────────────────────────
// pk              | sk                    | entity
// USER#userId     | PROFILE#userId        | User profile
// USER#userId     | EXPENSE#expenseId     | User's personal expense
// USER#userId     | GROUP_MEMBER#groupId  | Group memberships
// USER#userId     | NOTIFICATION#ts       | User notifications
// GROUP#groupId   | PROFILE#groupId       | Group profile
// GROUP#groupId   | EXPENSE#expenseId     | Group expense
// GROUP#groupId   | MEMBER#userId         | Group member
// EMAIL#email     | USER#userId           | Email lookup (inverted index)
// RECEIPT#expId   | SCAN#scanId           | Receipt scan results
// BUDGET#groupId  | PERIOD#YYYY-MM        | Budget per period

// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  // DynamoDB keys
  pk: string;           // USER#userId
  sk: string;           // PROFILE#userId
  gsi1pk: string;       // EMAIL#email
  gsi1sk: string;       // USER#userId
  entityType: "USER";

  // Attributes
  userId: string;
  email: string;
  name: string;
  avatarKey?: string;   // S3 key
  phone?: string;
  currency: string;     // "USD"
  timezone: string;     // "America/New_York"
  locale: string;       // "en-US"
  plan: "free" | "pro" | "business";

  // Preferences
  notificationPreferences: {
    email: boolean;
    push: boolean;
    sms: boolean;
    slack?: string;     // webhook URL
    digestFrequency: "daily" | "weekly" | "none";
  };

  // OCR/Scan settings
  defaultApprover?: string;   // userId
  autoApproveBelow?: number;  // auto-approve expenses < this amount

  // Metadata
  createdAt: string;    // ISO8601
  updatedAt: string;
  lastActiveAt: string;
  ttl?: number;         // DynamoDB TTL (deleted accounts)
}

// ─── Expense ──────────────────────────────────────────────────────────────────
export interface Expense {
  // DynamoDB keys
  pk: string;           // USER#userId OR GROUP#groupId
  sk: string;           // EXPENSE#expenseId
  gsi1pk: string;       // STATUS#status
  gsi1sk: string;       // DATE#date#expenseId (sorted by date)
  gsi2pk: string;       // CATEGORY#category
  gsi2sk: string;       // DATE#date#expenseId
  entityType: "EXPENSE";

  // Core fields
  expenseId: string;
  ownerId: string;        // userId who created
  groupId?: string;       // null for personal
  entityContext: EntityType;

  merchant: string;
  description?: string;
  amount: number;
  currency: string;
  exchangeRate?: number;  // if non-base currency
  amountUSD: number;      // normalized for reports

  category: string;
  subcategory?: string;
  tags: string[];

  date: string;           // YYYY-MM-DD (expense date)
  submittedAt?: string;   // ISO8601
  approvedAt?: string;
  rejectedAt?: string;
  reimbursedAt?: string;

  status: ExpenseStatus;
  approverId?: string;
  approverNote?: string;

  // Receipt
  receiptKey?: string;    // S3 key: receipts/{userId}/{expenseId}/{filename}
  receiptUrl?: string;    // Pre-signed URL (ephemeral)
  scanId?: string;        // Textract job ID

  // Splits (for group expenses)
  splits?:  (Split | Omit<Split, "settled" | "settledAt">)[];
  splitMethod?: SplitMethod;

  // Business fields
  projectCode?: string;
  costCenter?: string;
  billable?: boolean;
  reimbursable?: boolean;
  policyViolation?: string;

  // Metadata
  createdAt: string;
  updatedAt: string;
  source: ExpenseSource;
}

// ─── Split ────────────────────────────────────────────────────────────────────
export interface Split {
  userId: string;
  amount: number;         // exact amount owed
  percentage?: number;    // for percentage splits
  shares?: number;        // for shares-based splits
  settled: boolean;
  settledAt?: string;
  settledTxnId?: string;
}

// ─── Group ────────────────────────────────────────────────────────────────────
export interface Group {
  pk: string;           // GROUP#groupId
  sk: string;           // PROFILE#groupId
  gsi1pk: string;       // OWNER#ownerId
  gsi1sk: string;       // GROUP#groupId
  entityType: "GROUP";

  groupId: string;
  name: string;
  description?: string;
  type: "personal" | "trip" | "household" | "business" | "project";
  ownerId: string;
  color: string;          // hex color for UI
  iconEmoji?: string;

  members: GroupMember[];
  memberCount: number;

  // Budget
  budgets: Budget[];

  // Settings
  currency: string;
  approvalRequired: boolean;
  approvalThreshold?: number;   // require approval above this amount
  requireReceipts: boolean;
  requireReceiptsAbove?: number;

  // Business features
  policyId?: string;
  costCenters?: string[];
  projectCodes?: string[];

  // Metrics (updated by DynamoDB Streams Lambda)
  totalSpend: number;
  monthSpend: number;
  expenseCount: number;

  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  joinedAt: string;
  totalSpend: number;
  balance: number;      // positive = owed money, negative = owes money
}

export interface Budget {
  period: "monthly" | "quarterly" | "annual" | "trip";
  amount: number;
  currency: string;
  category?: string;
  alertAt: number;      // percentage (e.g. 0.8 = 80%)
  hardCap: boolean;     // block submissions over budget
}

// ─── Receipt Scan Result ──────────────────────────────────────────────────────
export interface ScanResult {
  pk: string;           // RECEIPT#expenseId
  sk: string;           // SCAN#scanId
  entityType: "SCAN";

  scanId: string;
  expenseId: string;
  userId: string;
  s3Key: string;
  s3Bucket: string;
  mimeType: string;
  fileSizeBytes: number;

  status: "pending" | "processing" | "completed" | "failed";
  textractJobId?: string;

  // Extracted data
  extractedData?: {
    merchant?: string;
    merchantAddress?: string;
    date?: string;
    time?: string;
    subtotal?: number;
    tax?: number;
    tip?: number;
    total?: number;
    currency?: string;
    paymentMethod?: string;
    last4?: string;
    lineItems?: LineItem[];
    rawText?: string;
  };

  // AI enrichment (Bedrock/Claude)
  aiEnrichment?: {
    category?: string;
    confidence: number;
    suggestedTags?: string[];
    policyFlags?: string[];
  };

  processingMs?: number;
  createdAt: string;
  ttl: number;          // Auto-delete scan metadata after 30 days
}

export interface LineItem {
  description: string;
  quantity?: number;
  unitPrice?: number;
  total: number;
}

// ─── API Request/Response Types ───────────────────────────────────────────────
export interface CreateExpenseRequest {
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  description?: string;
  groupId?: string;
  scanId?: string;
  tags?: string[];
  projectCode?: string;
  costCenter?: string;
  billable?: boolean;
  reimbursable?: boolean;
  splitMethod?: SplitMethod;
  splits?: Omit<Split, "settled" | "settledAt">[];
}

export interface UpdateExpenseRequest extends Partial<CreateExpenseRequest> {
  status?: ExpenseStatus;
  approverNote?: string;
}

export interface GetExpensesQuery {
  groupId?: string;
  status?: ExpenseStatus;
  category?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  nextToken?: string;  // base64 DynamoDB LastEvaluatedKey
}

export interface ExpenseSummary {
  totalAmount: number;
  currency: string;
  count: number;
  byCategory: Record<string, number>;
  byStatus: Record<ExpenseStatus, number>;
  period: string;
}

export interface InitiateUploadRequest {
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  expenseId?: string;  // if attaching to existing expense
}

export interface InitiateUploadResponse {
  uploadUrl: string;          // S3 pre-signed PUT URL
  s3Key: string;
  expenseId: string;          // new or existing
  scanId: string;             // poll this for results
  expiresAt: string;
}

// ─── Lambda Event Shapes ──────────────────────────────────────────────────────
export interface AuthContext {
  userId: string;
  email: string;
  groups: string[];     // Cognito groups
  plan: "free" | "pro" | "business";
}

export interface ApiEvent {
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: string;
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          sub: string;
          email: string;
          "cognito:groups": string;
        };
      };
    };
  };
}