// ─── CostsCrunch — App.tsx ───────────────────────────────────────────────────
// Thin orchestrator: layout, routing, global modal state.
// All data lives in useExpenseStore. All UI lives in components/ and pages/.

import { useState, useEffect, useCallback } from "react";
import { useExpenseStore, selectPending } from "./stores/useExpenseStore";
import { useThemeStore, initSystemThemeListener, selectMode } from "./stores/useThemeStore";
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
import { useIsMobile, useSwipeGesture } from "./helpers/mobile-utils";

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
  const [showScan, setShowScan] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const addExpense = useExpenseStore((s) => s.addExpense);
  const fetchExpenses = useExpenseStore((s) => s.fetchExpenses);
  const expenses   = useExpenseStore((s) => s.expenses);
  const pending    = useExpenseStore(selectPending);

  // Theme integration - subscribe to mode directly for reactivity
  const mode = useThemeStore(selectMode);
  const resolvedTheme = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;

  const isMobile = useIsMobile();

  useEffect(() => {
    initSystemThemeListener();
    fetchExpenses();
  }, [fetchExpenses]);

  // Swipe to open sidebar (mobile only)
  useSwipeGesture(
    useCallback(() => {
      if (isMobile && !sidebarOpen) {
        setSidebarOpen(true);
      }
    }, [isMobile, sidebarOpen])
  );

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
    <div className={`theme-${resolvedTheme}`} style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
      {showScan && (
        <ScanModal
          onClose={() => setShowScan(false)}
          onAdd={(exp) => {
            addExpense(exp);
            setShowScan(false);
          }}
        />
      )}

      {/* Mobile Sidebar */}
      {isMobile && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as PageId)}
          pendingCount={expenses.length}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          isMobile={true}
        />
      )}

      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={(id) => setActiveTab(id as PageId)}
          pendingCount={expenses.length}
        />
      )}

      <div className="main-content" style={{ marginLeft: isMobile ? 0 : "var(--sidebar-width)", minHeight: "100vh" }}>
        <TopBar
          activeTab={activeTab}
          onScan={() => setShowScan(true)}
          onAdd={handleAddBlankExpense}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main style={{ padding: isMobile ? "16px" : "32px" }}>
          <PageComponent />
        </main>
      </div>
    </div>
  );
}
