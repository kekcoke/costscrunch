// ─── CostsCrunch — TopBar Component ──────────────────────────────────────────
import type { TopBarProps } from "../models/interfaceProps";
import ThemeSlider from "./themeSlider";

interface ExtendedTopBarProps extends TopBarProps {
  onMenuClick?: () => void;
}

export default function TopBar({ onScan, onAdd, onMenuClick }: ExtendedTopBarProps) {
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
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* Mobile menu button */}
        <button
          className="mobile-menu-btn"
          onClick={onMenuClick}
          aria-label="Open menu"
          style={{
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            width: "36px",
            height: "36px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "8px",
            cursor: "pointer",
            fontSize: "18px",
            padding: 0,
          }}
        >
          ☰
        </button>
      </div>

      <div className="topbar-actions" style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
          <span aria-hidden>📷</span>
          <span className="hide-mobile"> Scan Receipt</span>
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
          <span className="show-mobile-inline">+</span>
          <span className="hide-mobile"> Add Expense</span>
        </button>
      </div>
    </header>
  );
}
