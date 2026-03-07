import type { ScanForm, ScanStage } from "../../models/scan";
import type { Expense } from "../../models/types";


export const createExpenseFromForm = (
  form: ScanForm, 
  stage: ScanStage,
  userId: string = "user1", // TODO: Get from auth context
  userName: string = "You"
): Omit<Expense, "id"> => {
  const amount = parseFloat(form.amount) || 0;
  const now = new Date().toISOString();
  
  return {
    // Form fields
    merchant: form.merchant,
    amount: amount,
    category: form.category,
    date: form.date,
    notes: form.notes,
    
    // Default fields
    status: "pending",
    receipt: stage === "result",
    addedBy: userName,
    groupId: null,
    currency: "USD",
    
    // Required fields
    ownerId: userId,
    amountUSD: amount, // Since currency is USD
    tags: [],
    createdAt: now,
    source: stage === "result" ? "scan" : "manual",
    
    // Optional but recommended
    description: form.notes,
    updatedAt: now,
    reimbursable: true,
    billable: false,
    splitMethod: undefined,
    splits: [],
    
    // Optional fields with defaults
    subcategory: undefined,
    exchangeRate: 1.0,
    submittedAt: now,
    approvedAt: undefined,
    rejectedAt: undefined,
    reimbursedAt: undefined,
    approverId: undefined,
    approverNote: undefined,
    receiptKey: undefined,
    receiptUrl: undefined,
    projectCode: undefined,
    costCenter: undefined,
    policyViolation: undefined,
  };
};