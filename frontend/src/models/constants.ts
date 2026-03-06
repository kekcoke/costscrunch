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
