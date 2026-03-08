import { type Expense } from "../models/types";

let expenseCounter = 1;

export function createMockExpense(
  overrides: Partial<Expense> = {}
): Expense {
  const id = overrides.id ?? `e${expenseCounter++}`;

  const base: Expense = {
    id,
    ownerId: "user1",
    groupId: null,

    merchant: "Test Merchant",
    description: null,

    amount: 100,
    currency: "USD",
    exchangeRate: 1,
    amountUSD: 100,

    category: "Misc",
    subcategory: null,
    tags: [],

    date: "2026-03-01",

    submittedAt: "2026-03-01T10:00:00Z",
    approvedAt: null,
    rejectedAt: null,
    reimbursedAt: null,

    status: "pending",
    approverId: null,
    approverNote: null,

    receipt: false,
    receiptKey: null,
    receiptUrl: null,

    splits: [],
    splitMethod: null,

    projectCode: null,
    costCenter: null,
    billable: false,
    reimbursable: true,

    policyViolation: null,

    createdAt: new Date().toISOString(),
    updatedAt: null,

    source: "manual",
    addedBy: "You",
    notes: null,
  };

  return {
    ...base,
    ...overrides
  };
}

export const MOCK_EXPENSES: Expense[] = [
  createMockExpense({
    id: "e1",
    merchant: "Whole Foods Market",
    description: "Weekly groceries",
    amount: 142.87,
    amountUSD: 142.87,
    category: "Groceries",
    subcategory: "Food",
    tags: ["groceries", "personal"],
    status: "approved",
    approvedAt: "2026-02-28T14:20:00Z",
    reimbursedAt: "2026-03-01T09:00:00Z",
    receipt: true,
    receiptKey: "receipts/e1-wholefoods.pdf"
  }),

  createMockExpense({
    id: "e2",
    groupId: "group1",
    merchant: "Delta Airlines",
    description: "NYC → SFO",
    amount: 428,
    amountUSD: 428,
    category: "Travel",
    subcategory: "Flights",
    tags: ["travel", "business"],
    projectCode: "Q1-OFFSITE",
    costCenter: "MARKETING",
    splitMethod: "equal",
    splits: [
      { userId: "user1", amount: 214, percentage: 50, settledAt: "", shares: 1 },
      { userId: "user2", amount: 214, percentage: 50, settledAt: "", shares: 1 }
    ],
    receipt: true,
    status: "approved"
  }),

  createMockExpense({
    id: "e3",
    ownerId: "user3",
    groupId: "group2",
    merchant: "AWS Console",
    amount: 1204.33,
    amountUSD: 1204.33,
    category: "Software",
    subcategory: "Cloud Services",
    tags: ["software", "infra"],
    status: "approved",
    approvedAt: "2026-02-26T11:30:00Z",
    projectCode: "ACME-CLOUD",
    costCenter: "ENGINEERING",
    source: "scan",
    addedBy: "Sarah K."
  })
];