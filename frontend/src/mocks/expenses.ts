import type { Expense } from "../models/types";

export const MOCK_EXPENSES: Expense[] = [
  {
    id: "e1",
    ownerId: "user1",
    groupId: null,
    merchant: "Whole Foods Market",
    description: "Weekly groceries",
    amount: 142.87,
    currency: "USD",
    exchangeRate: 1,
    amountUSD: 142.87,
    category: "Groceries",
    subcategory: "Food",
    tags: ["groceries", "personal"],
    date: "2026-02-28",

    submittedAt: "2026-02-28T10:30:00Z",
    approvedAt: "2026-02-28T14:20:00Z",
    rejectedAt: null,
    reimbursedAt: "2026-03-01T09:00:00Z",

    status: "approved",
    approverId: "approver1",
    approverNote: "Approved",

    receipt: true,
    receiptKey: "receipts/e1-wholefoods.pdf",
    receiptUrl: "https://storage.example.com/receipts/e1-wholefoods.pdf",

    splits: [],
    splitMethod: null,

    projectCode: null,
    costCenter: null,
    billable: false,
    reimbursable: true,

    policyViolation: null,

    createdAt: "2026-02-28T10:30:00Z",
    updatedAt: "2026-02-28T14:20:00Z",
    source: "manual",
    addedBy: "You",
    notes: "Weekly groceries"
  },
  {
    id: "e2",
    ownerId: "user1",
    groupId: "group1",
    merchant: "Delta Airlines",
    description: "NYC → SFO flight",
    amount: 428,
    currency: "USD",
    exchangeRate: 1,
    amountUSD: 428,
    category: "Travel",
    subcategory: "Flights",
    tags: ["travel", "business", "q1-offsite"],
    date: "2026-02-26",

    submittedAt: "2026-02-26T09:15:00Z",
    approvedAt: null,
    rejectedAt: null,
    reimbursedAt: null,

    status: "pending",
    approverId: null,
    approverNote: null,

    receipt: true,
    receiptKey: "receipts/e2-delta.pdf",
    receiptUrl: "https://storage.example.com/receipts/e2-delta.pdf",

    splitMethod: "equal",
    splits: [
      { userId: "user1", amount: 214, percentage: 50, settledAt: "", shares: 1 },
      { userId: "user2", amount: 214, percentage: 50, settledAt: "", shares: 1 }
    ],

    projectCode: "Q1-OFFSITE",
    costCenter: "MARKETING",
    billable: true,
    reimbursable: true,

    policyViolation: null,

    createdAt: "2026-02-26T09:15:00Z",
    updatedAt: "2026-02-26T09:15:00Z",
    source: "manual",
    addedBy: "You",
    notes: "NYC → SFO"
  },
  {
    id: "e3",
    ownerId: "user3",
    groupId: "group2",
    merchant: "AWS Console",
    description: "February cloud infrastructure",
    amount: 1204.33,
    currency: "USD",
    exchangeRate: 1,
    amountUSD: 1204.33,
    category: "Software",
    subcategory: "Cloud Services",
    tags: ["software", "infrastructure", "acme"],
    date: "2026-02-25",

    submittedAt: "2026-02-25T08:00:00Z",
    approvedAt: "2026-02-26T11:30:00Z",
    rejectedAt: null,
    reimbursedAt: null,

    status: "approved",
    approverId: "approver2",
    approverNote: "Approved - within budget",

    receipt: true,
    receiptKey: "receipts/e3-aws.pdf",
    receiptUrl: "https://storage.example.com/receipts/e3-aws.pdf",

    splitMethod: null,
    splits: [],

    projectCode: "ACME-CLOUD",
    costCenter: "ENGINEERING",
    billable: true,
    reimbursable: true,

    policyViolation: null,

    createdAt: "2026-02-25T08:00:00Z",
    updatedAt: "2026-02-26T11:30:00Z",
    source: "email",
    addedBy: "Sarah K.",
    notes: "Feb cloud infra"
  },
  {
    id: "e7",
    ownerId: "user7",
    groupId: "group2",
    merchant: "WeWork Dallas",
    description: "Hot desk February",
    amount: 650,
    currency: "USD",
    exchangeRate: 1,
    amountUSD: 650,
    category: "Office",
    subcategory: "Coworking",
    tags: ["office", "coworking", "acme"],
    date: "2026-02-20",

    submittedAt: "2026-02-20T11:00:00Z",
    approvedAt: null,
    rejectedAt: "2026-02-22T13:20:00Z",
    reimbursedAt: null,

    status: "rejected",
    approverId: "approver2",
    approverNote: "Rejected - outside policy limits for hot desks",

    receipt: true,
    receiptKey: "receipts/e7-wework.pdf",
    receiptUrl: "https://storage.example.com/receipts/e7-wework.pdf",

    splitMethod: null,
    splits: [],

    projectCode: "ACME-OPS",
    costCenter: "ADMIN",
    billable: false,
    reimbursable: true,

    policyViolation: "Exceeds monthly hot desk limit of $500",

    createdAt: "2026-02-20T11:00:00Z",
    updatedAt: "2026-02-22T13:20:00Z",
    source: "manual",
    addedBy: "Jordan L.",
    notes: "Hot desk Feb"
  }
];