// ─── CostsCrunch — TopBar Component ──────────────────────────────────────────
import type { TopBarProps } from "../models/interfaceProps";
import ThemeSlider from "./themeSlider";

const PAGE_TITLES: Record<string, string> = {
  dashboard: "Overview",
  expenses:  "All Expenses",
  groups:    "Groups & Splits",
  analytics: "Analytics",
  settings:  "Settings",
};

export default function TopBar({ activeTab, onScan, onAdd }: TopBarProps) {
  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 9,
        background: "var(--color-surface-3)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--color-border-dim)",
        padding: "16px 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}
    >
      <div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "20px", fontWeight: 700,
            letterSpacing: "-0.5px", margin: 0,
          }}
        >
          {PAGE_TITLES[activeTab] ?? activeTab}
        </h1>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "2px" }}>
          February 2026
        </div>
      </div>

      <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
        <ThemeSlider />

        <button
          onClick={onScan}
          style={{
            display: "flex", alignItems: "center", gap: "7px",
            background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
            border: "none", borderRadius: "10px", padding: "10px 18px",
            color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer",
          }}
        >
          <span aria-hidden>📷</span> Scan Receipt
        </button>

        <button
          onClick={onAdd}
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px", padding: "10px 18px",
            color: "var(--color-text-muted)", fontWeight: 600,
            fontSize: "13px", cursor: "pointer",
          }}
        >
          + Add Expense
        </button>
      </div>
    </header>
  );
}