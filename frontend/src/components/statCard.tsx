// ─── CostsCrunch — StatCard Component ────────────────────────────────────────
import type { StatCardProps } from "../models/interfaceProps";

export default function StatCard({
  label,
  value,
  sub,
  accent,
  delay = 0,
}: StatCardProps) {
  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "16px",
        padding: "24px",
        animation: `fadeUp 0.5s ${delay}s both`,
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "var(--color-text-dim)",
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "10px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "28px",
          fontWeight: 800,
          color: accent ?? "var(--color-text)",
          fontFamily: "var(--font-display)",
          letterSpacing: "-1px",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
          {sub}
        </div>
      )}
    </div>
  );
}