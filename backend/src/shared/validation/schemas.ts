// ─── CostsCrunch — Zod Validation Schemas ───────────────────────────────────
// Centralized input validation for all API routes

import { z } from 'zod';

// ── Primitives ────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const emailSchema = z.string().email();
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const isoDateTimeSchema = z.string().datetime();
const ulidSchema = z.string().min(1).max(36);
const currencySchema = z.string().length(3).toUpperCase();
const urlSchema = z.string().url();

// ── Enums ────────────────────────────────────────────────────────────────────

export const expenseStatusSchema = z.enum(['draft', 'pending', 'submitted', 'approved', 'rejected', 'reimbursed']);
export const entityTypeSchema = z.enum(['PERSONAL', 'GROUP', 'BUSINESS']);
export const splitMethodSchema = z.enum(['equal', 'exact', 'percentage', 'shares']);
export const userRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const notificationChannelSchema = z.enum(['email', 'push', 'sms', 'slack']);
export const expenseSourceSchema = z.enum(['manual', 'scan', 'bank_sync', 'api']);

// ── Split Schemas ─────────────────────────────────────────────────────────────

export const splitSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  percentage: z.number().min(0).max(100).optional(),
  shares: z.number().positive().optional(),
  settled: z.boolean().default(false),
  settledAt: isoDateTimeSchema.optional(),
  settledTxnId: z.string().optional(),
});

export const splitInputSchema = splitSchema.omit({ settled: true, settledAt: true, settledTxnId: true });

// ── Expense Schemas ──────────────────────────────────────────────────────────

export const createExpenseSchema = z.object({
  merchant: z.string().min(1, 'Merchant is required').max(200, 'Merchant name too long'),
  amount: z.number().positive('Amount must be positive').max(1_000_000, 'Amount exceeds maximum'),
  currency: currencySchema,
  category: z.string().max(50).optional().default('Other'),
  date: isoDateSchema,
  description: z.string().max(1000).optional(),
  groupId: ulidSchema.optional(),
  scanId: ulidSchema.optional(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  projectCode: z.string().max(50).optional(),
  costCenter: z.string().max(50).optional(),
  billable: z.boolean().optional(),
  reimbursable: z.boolean().optional(),
  splitMethod: splitMethodSchema.optional(),
  splits: z.array(splitInputSchema).max(50).optional(),
}).strict();

export const updateExpenseSchema = z.object({
  merchant: z.string().min(1).max(200).optional(),
  category: z.string().max(50).optional(),
  date: isoDateSchema.optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  groupId: ulidSchema.optional(),
  projectCode: z.string().max(50).optional(),
  costCenter: z.string().max(50).optional(),
  billable: z.boolean().optional(),
  reimbursable: z.boolean().optional(),
  status: expenseStatusSchema.optional(),
  approverNote: z.string().max(500).optional(),
});

export const getExpensesQuerySchema = z.object({
  groupId: ulidSchema.optional(),
  status: expenseStatusSchema.optional(),
  category: z.string().max(50).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  nextToken: z.string().optional(),
}).strict();

export const exportExpensesQuerySchema = z.object({
  format: z.enum(["csv", "json"]).optional().default("csv"),
  groupId: ulidSchema.optional(),
  status: expenseStatusSchema.optional(),
  category: z.string().max(50).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(10000).optional().default(10000),
}).strict();

// ── Group Schemas ─────────────────────────────────────────────────────────────

export const budgetSchema = z.object({
  period: z.enum(['monthly', 'quarterly', 'annual', 'trip']),
  amount: z.number().positive(),
  currency: currencySchema,
  category: z.string().max(50).optional(),
  alertAt: z.number().min(0).max(1).optional().default(0.8),
  hardCap: z.boolean().optional().default(false),
});

export const groupMemberInputSchema = z.object({
  userId: z.string().optional(),
  email: emailSchema.optional(),
  name: z.string().min(1).max(100).optional(),
  role: userRoleSchema.optional().default('member'),
});

export const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().max(500).optional(),
  type: z.enum(['personal', 'trip', 'household', 'business', 'project']).optional().default('personal'),
  currency: currencySchema.optional().default('USD'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional().default('#4F46E5'),
  iconEmoji: z.string().max(10).optional(),
  approvalRequired: z.boolean().optional().default(true),
  approvalThreshold: z.number().positive().optional(),
  requireReceipts: z.boolean().optional().default(false),
  requireReceiptsAbove: z.number().positive().optional(),
  policyId: z.string().max(50).optional(),
  costCenters: z.array(z.string().max(50)).max(20).optional(),
  projectCodes: z.array(z.string().max(50)).max(20).optional(),
  budgets: z.array(budgetSchema).max(12).optional(),
}).strict();

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  type: z.enum(['personal', 'trip', 'household', 'business', 'project']).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  iconEmoji: z.string().max(10).optional(),
  currency: currencySchema.optional(),
  approvalRequired: z.boolean().optional(),
  approvalThreshold: z.number().positive().optional(),
  requireReceipts: z.boolean().optional(),
  requireReceiptsAbove: z.number().positive().optional(),
  policyId: z.string().max(50).optional().nullable(),
  costCenters: z.array(z.string().max(50)).max(20).optional().nullable(),
  projectCodes: z.array(z.string().max(50)).max(20).optional().nullable(),
  budgets: z.array(budgetSchema).max(12).optional().nullable(),
  active: z.boolean().optional(),
}).strict();

export const addGroupMemberSchema = z.object({
  userId: z.string().optional(),
  email: emailSchema,
  name: z.string().min(1).max(100).optional(),
  role: userRoleSchema.optional().default('member'),
}).strict();

// ── Receipt Schemas ───────────────────────────────────────────────────────────

export const initiateUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().regex(/^(image\/(jpeg|png|heic|webp)|application\/pdf)$/, 'Unsupported file type'),
  fileSizeBytes: z.number().int().positive().max(10 * 1024 * 1024, 'File exceeds 10MB limit').optional(),
  expenseId: ulidSchema.optional(),
}).strict();

// ── Analytics Schemas ────────────────────────────────────────────────────────

export const analyticsQuerySchema = z.object({
  period: z.enum(['month', 'quarter', 'year']).optional().default('month'),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  groupId: ulidSchema.optional(),
  category: z.string().max(50).optional(),
}).strict();

// ── Validation Helper ────────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; details?: z.ZodError };

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
  return { success: false, error: errors.join('; '), details: result.error };
}
