// ─── CostsCrunch — App.tsx ───────────────────────────────────────────────────
// Thin orchestrator: layout, routing, global modal state.
// All data lives in useExpenseStore. All UI lives in components/ and pages/.

import { useState } from "react";
import { useExpenseStore, selectPending } from "./stores/useExpenseStore";
import { Sidebar, TopBar, ScanModal } from "./components";
import {
  DashboardPage,
  ExpensesPage,
  GroupsPage,
  AnalyticsPage,
  SettingsPage,
} from "./pages";
import type { FC } from "react";
import { type ExpenseStatus, type ExpenseSource } from "./models/types";

type PageId = "dashboard" | "expenses" | "groups" | "analytics" | "settings";

const PAGES: Record<PageId, FC> = {
  dashboard: DashboardPage,
  expenses:  ExpensesPage,
  groups:    GroupsPage,
  analytics: AnalyticsPage,
  settings:  SettingsPage,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<PageId>("dashboard");
  const [showScan,  setShowScan]  = useState(false);

  const addExpense = useExpenseStore((s) => s.addExpense);
  const pending    = useExpenseStore(selectPending);

  const PageComponent = PAGES[activeTab] ?? DashboardPage;

  const handleAddBlankExpense = () => {
    addExpense({
      merchant:  "New Expense",
      amount:    0,
      category:  "Other",
      date:      new Date().toISOString().slice(0, 10),
      status:    "draft" as ExpenseStatus,
      receipt:   false,
      currency:  "USD",
      addedBy:   "You",
      groupId:    "",
      notes:      "",
      ownerId:    "",
      amountUSD:  0,
      tags: [""],
      createdAt: new Date().toISOString(),
      source: "manual" as ExpenseSource
    });
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      {showScan && (
        <ScanModal
          onClose={() => setShowScan(false)}
          onAdd={(exp) => {
            addExpense(exp);
            setShowScan(false);
          }}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as PageId)}
        pendingCount={pending.length}
      />

      <div style={{ marginLeft: "var(--sidebar-width)", minHeight: "100vh" }}>
        <TopBar
          activeTab={activeTab}
          onScan={() => setShowScan(true)}
          onAdd={handleAddBlankExpense}
        />
        <main style={{ padding: "32px" }}>
          <PageComponent />
        </main>
      </div>
    </div>
  );
}