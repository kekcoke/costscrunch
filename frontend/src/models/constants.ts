// ─── CostsCrunch — Shared Constants ────────────────────────────────────────────

/** @type {Record<string, { icon: string; color: string }>} */
export const CATEGORIES = {
  Groceries: { icon: "🛒", color: "#10b981" },
  Travel:    { icon: "✈️", color: "#6366f1" },
  Software:  { icon: "💻", color: "#8b5cf6" },
  Meals:     { icon: "🍽️", color: "#f59e0b" },
  Office:    { icon: "🏢", color: "#3b82f6" },
  Equipment: { icon: "📦", color: "#ef4444" },
  Other:     { icon: "📁", color: "#64748b" },
};

export const CATEGORY_NAMES = Object.keys(CATEGORIES);

/** @type {Record<string, string>} */
export const STATUS_COLORS = {
  approved: "#10b981",
  pending:  "#f59e0b",
  rejected: "#ef4444",
  draft:    "#64748b",
};

export const NAV_ITEMS = [
  { id: "dashboard", icon: "▦", label: "Dashboard" },
  { id: "expenses",  icon: "≡", label: "Expenses" },
  { id: "groups",    icon: "◎", label: "Groups" },
  { id: "analytics", icon: "∿", label: "Analytics" },
  { id: "settings",  icon: "⚙", label: "Settings" },
];

// ─── Mock Data (move to /src/mocks/ or remove when wiring real API) ───────────
export const MOCK_EXPENSES = [
  { id: "e1", merchant: "Whole Foods Market",  category: "Groceries", amount: 142.87,   date: "2026-02-28", status: "approved", receipt: true,  currency: "USD", addedBy: "You",      group: null,       notes: "Weekly groceries" },
  { id: "e2", merchant: "Delta Airlines",      category: "Travel",    amount: 428.00,   date: "2026-02-26", status: "pending",  receipt: true,  currency: "USD", addedBy: "You",      group: "Q1 Offsite",notes: "NYC → SFO" },
  { id: "e3", merchant: "AWS Console",         category: "Software",  amount: 1204.33,  date: "2026-02-25", status: "approved", receipt: true,  currency: "USD", addedBy: "Sarah K.", group: "Acme Corp", notes: "Feb cloud infra" },
  { id: "e4", merchant: "Nobu Restaurant",     category: "Meals",     amount: 287.50,   date: "2026-02-24", status: "approved", receipt: false, currency: "USD", addedBy: "Marcus T.",group: "Q1 Offsite",notes: "Client dinner" },
  { id: "e5", merchant: "Figma Pro",           category: "Software",  amount: 45.00,    date: "2026-02-22", status: "approved", receipt: true,  currency: "USD", addedBy: "You",      group: null,       notes: "Monthly sub" },
  { id: "e6", merchant: "Uber Eats",           category: "Meals",     amount: 34.20,    date: "2026-02-21", status: "approved", receipt: true,  currency: "USD", addedBy: "You",      group: null,       notes: "" },
  { id: "e7", merchant: "WeWork Dallas",       category: "Office",    amount: 650.00,   date: "2026-02-20", status: "rejected", receipt: true,  currency: "USD", addedBy: "Jordan L.",group: "Acme Corp", notes: "Hot desk Feb" },
  { id: "e8", merchant: "Apple Store",         category: "Equipment", amount: 1899.00,  date: "2026-02-18", status: "approved", receipt: true,  currency: "USD", addedBy: "You",      group: null,       notes: "MacBook Pro M4" },
];

export const MOCK_GROUPS = [
  { id: "g1", name: "Q1 Offsite", members: 8, total: 4287.50,  myShare: 535.93,  color: "#6366f1" },
  { id: "g2", name: "Acme Corp",  members: 3, total: 12403.18, myShare: 4134.39, color: "#f59e0b" },
  { id: "g3", name: "Home",       members: 2, total: 3241.00,  myShare: 1620.50, color: "#10b981" },
];

export const SCAN_MOCK_RESULTS = [
  { merchant: "Starbucks Reserve",      amount: "23.45",  category: "Meals",   date: "2026-02-28", notes: "Latte × 2, Croissant",      confidence: 98 },
  { merchant: "Marriott Hotel Chicago", amount: "342.00", category: "Travel",  date: "2026-02-27", notes: "1 night stay — Room 412",   confidence: 95 },
  { merchant: "Office Depot",           amount: "67.89",  category: "Office",  date: "2026-02-26", notes: "Paper, pens, stapler",       confidence: 91 },
];

// ─── Page: Settings ───────────────────────────────────────────────────────────
export const SETTINGS_SECTIONS = [
  {
    title: "Profile",
    items: [
      { label: "Name",     value: "Alex Johnson" },
      { label: "Email",    value: "alex@acme.io" },
      { label: "Currency", value: "USD ($)" },
      { label: "Timezone", value: "America/New_York" },
    ],
  },
  {
    title: "Notifications",
    items: [
      { label: "Email on approval",       value: "✅ Enabled" },
      { label: "Push on group expense",   value: "✅ Enabled" },
      { label: "Weekly digest",           value: "✅ Enabled" },
      { label: "Anomaly alerts",          value: "✅ Enabled" },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Slack",       value: "Connected ✅" },
      { label: "Plaid",       value: "Not connected" },
      { label: "QuickBooks",  value: "Connected ✅" },
      { label: "Xero",        value: "Not connected" },
    ],
  },
];
