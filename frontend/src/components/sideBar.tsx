// ─── CostsCrunch — Sidebar Component ─────────────────────────────────────────
import { NAV_ITEMS } from "../models/constants";
import type { SideBarProps } from "../models/interfaceProps";

export default function Sidebar({
  activeTab,
  onTabChange,
  pendingCount,
}: SideBarProps) {
  return (
    <aside
      style={{
        position: "fixed", left: 0, top: 0, bottom: 0,
        width: "var(--sidebar-width)",
        background: "var(--color-surface-3)",
        borderRight: "1px solid var(--color-border-dim)",
        display: "flex", flexDirection: "column",
        padding: "28px 0",
        zIndex: 10,
      }}
    >
      {/* Logo */}
      <div style={{ padding: "0 20px 28px", borderBottom: "1px solid var(--color-border-dim)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            aria-hidden
            style={{
              width: "34px", height: "34px",
              background: "linear-gradient(135deg, #0ea5e9, #6366f1)",
              borderRadius: "9px",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "16px",
            }}
          >
            💸
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "17px", letterSpacing: "-0.5px" }}>
              CostsCrunch
            </div>
            <div style={{ fontSize: "10px", color: "var(--color-text-dim)", letterSpacing: "1px" }}>
              EXPENSE TRACKER
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" style={{ flex: 1, padding: "16px 12px" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: "10px",
                padding: "10px 12px", borderRadius: "9px", border: "none",
                background: isActive ? "var(--color-surface-2)" : "transparent",
                color: isActive ? "var(--color-indigo)" : "var(--color-text-dim)",
                cursor: "pointer", fontSize: "14px",
                fontWeight: isActive ? 600 : 400,
                marginBottom: "2px", transition: "all 0.15s",
                textAlign: "left",
              }}
            >
              <span aria-hidden style={{ fontSize: "16px", width: "20px", textAlign: "center" }}>
                {item.icon}
              </span>
              {item.label}
              {item.id === "expenses" && pendingCount > 0 && (
                <span
                  aria-label={`${pendingCount} pending`}
                  style={{
                    marginLeft: "auto",
                    background: "var(--color-amber)", color: "var(--color-bg)",
                    fontSize: "10px", fontWeight: 700,
                    padding: "2px 6px", borderRadius: "4px",
                  }}
                >
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* User */}
      <div style={{ padding: "16px 20px", borderTop: "1px solid var(--color-border-dim)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            aria-hidden
            style={{
              width: "32px", height: "32px", borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #0ea5e9)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "13px", fontWeight: 700, flexShrink: 0,
            }}
          >
            AJ
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-muted)" }}>
              Alex Johnson
            </div>
            <div style={{ fontSize: "11px", color: "var(--color-text-dimmer)" }}>Pro Plan</div>
          </div>
        </div>
      </div>
    </aside>
  );
}