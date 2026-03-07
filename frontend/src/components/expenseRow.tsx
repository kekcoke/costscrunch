// ─── CostsCrunch — ExpenseRow Component ──────────────────────────────────────
import { CATEGORIES, STATUS_COLORS } from "../models/constants";
import { createKeyValidator, fmt, fmtDate } from "../helpers/utils";
import type { ExpenseRowProps } from "../models/interfaceProps";

export default function ExpenseRow({ expense, delay = 0 }: ExpenseRowProps) {
  const isValidCategory = createKeyValidator(CATEGORIES, 'CATEGORIES');
  const cat = isValidCategory(expense.category) 
    ? CATEGORIES[expense.category] 
    : CATEGORIES.Other;

  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        display: "grid",
        gridTemplateColumns: "40px 1fr auto auto auto",
        alignItems: "center",
        gap: "16px",
        padding: "14px 20px",
        borderBottom: "1px solid var(--color-border-dim)",
        transition: "background 0.15s",
        cursor: "pointer",
        animation: `fadeUp 0.4s ${delay}s both`,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#0a1628"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {/* Category icon */}
      <div
        style={{
          width: "40px", height: "40px",
          borderRadius: "10px",
          background: cat.color + "18",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "18px", flexShrink: 0,
        }}
      >
        {cat.icon}
      </div>

      {/* Merchant + meta */}
      <div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text)" }}>
          {expense.merchant}
        </div>
        <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "2px", display: "flex", gap: "10px" }}>
          <span>{fmtDate(expense.date)}</span>
          {expense?.groupId && (
            <span style={{ color: "var(--color-indigo)" }}>• {expense.groupId}</span>
          )}
          {expense.addedBy !== "You" && <span>• {expense.addedBy}</span>}
        </div>
      </div>

      {/* Category badge */}
      <div
        style={{
          fontSize: "11px",
          background: cat.color + "18",
          color: cat.color,
          padding: "3px 8px",
          borderRadius: "5px",
          fontWeight: 600,
        }}
      >
        {expense.category}
      </div>

      {/* Amount + status */}
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text)" }}>
          {fmt(expense.amount)}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: STATUS_COLORS[expense.status] ?? STATUS_COLORS.draft,
            marginTop: "2px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {expense.status}
        </div>
      </div>

      {/* Receipt indicator */}
      <div
        style={{ fontSize: "16px", opacity: expense.receipt ? 1 : 0.2 }}
        title={expense.receipt ? "Receipt attached" : "No receipt"}
        aria-label={expense.receipt ? "Receipt attached" : "No receipt"}
      >
        📎
      </div>
    </div>
  );
}