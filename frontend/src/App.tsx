// ─── CostsCrunch — App.tsx ───────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";
import { useExpenseStore, selectPending } from "./stores/useExpenseStore";
import { useThemeStore, initSystemThemeListener, selectMode } from "./stores/useThemeStore";
import { Sidebar, TopBar, ScanModal } from "./components";
import {
  DashboardPage,
  ExpensesPage,
  GroupsPage,
  AnalyticsPage,
  SettingsPage,
  LandingPage,
  LoginPage,
  RegisterPage,
  MfaPage,
  PasswordResetPage,
} from "./pages";
import type { FC } from "react";
import { type ExpenseStatus, type ExpenseSource } from "./models/types";
import { useIsMobile, useSwipeGesture } from "./helpers/mobile-utils";

type PageId = 
  | "dashboard" | "expenses" | "groups" | "analytics" | "settings" 
  | "landing" | "login" | "register" | "mfa" | "password-reset";

const APP_PAGES: Record<string, FC> = {
  dashboard: DashboardPage,
  expenses:  ExpensesPage,
  groups:    GroupsPage,
  analytics: AnalyticsPage,
  settings:  SettingsPage,
};

const AUTH_PAGES: Record<string, FC> = {
  landing: LandingPage,
  login: LoginPage,
  register: RegisterPage,
  mfa: MfaPage,
  "password-reset": PasswordResetPage,
};

export default function App() {
  // Simple routing state for MVP
  const [activeTab, setActiveTab] = useState<PageId>("landing");
  const [showScan, setShowScan] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const addExpense = useExpenseStore((s) => s.addExpense);
  const fetchExpenses = useExpenseStore((s) => s.fetchExpenses);
  const expenses   = useExpenseStore((s) => s.expenses);

  const mode = useThemeStore(selectMode);
  const resolvedTheme = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;

  const isMobile = useIsMobile();

  useEffect(() => {
    initSystemThemeListener();
    if (activeTab in APP_PAGES) {
      fetchExpenses();
    }
  }, [fetchExpenses, activeTab]);

  useSwipeGesture(
    useCallback(() => {
      if (isMobile && !sidebarOpen) {
        setSidebarOpen(true);
      }
    }, [isMobile, sidebarOpen])
  );

  const isAuthView = activeTab in AUTH_PAGES;
  const PageComponent = (isAuthView ? AUTH_PAGES[activeTab] : APP_PAGES[activeTab]) ?? LandingPage;

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

  // If we are in an auth/landing view, don't show the sidebar or topbar
  if (isAuthView) {
    return (
      <div className={`theme-${resolvedTheme}`} style={{ minHeight: "100vh", background: "var(--color-bg)", color: "var(--color-text)" }}>
        <main>
          {/* Simple navigation bridge for testing/dev */}
          <div style={{ position: 'fixed', bottom: 10, right: 10, opacity: 0.1, zIndex: 9999 }}>
             <button onClick={() => setActiveTab('dashboard')}>Skip to App</button>
             <button onClick={() => setActiveTab('login')}>Login</button>
             <button onClick={() => setActiveTab('register')}>Sign up</button>
          </div>
          <PageComponent />
        </main>
      </div>
    );
  }

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

      <Sidebar
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as PageId)}
        pendingCount={expenses.length}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        isMobile={isMobile}
      />

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
