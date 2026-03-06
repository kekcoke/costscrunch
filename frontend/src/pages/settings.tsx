// ─── CostsCrunch — SettingsPage ──────────────────────────────────────────────
import { SETTINGS_SECTIONS } from "../models/constants";

export function SettingsPage() {
  return (
    <div style={{ animation: "fadeUp 0.4s both", maxWidth: "640px" }}>
      {SETTINGS_SECTIONS.map((section) => (
        <div
          key={section.title}
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "16px",
            padding: "24px",
            marginBottom: "16px",
          }}
        >
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>
            {section.title}
          </div>
          {section.items.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 0",
                borderBottom: "1px solid var(--color-surface-2)",
                fontSize: "13px", color: "var(--color-text-muted)",
              }}
            >
              <span>{label}</span>
              <span style={{ color: value.includes("✅") ? "#10b981" : "var(--color-text-dim)" }}>
                {value}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}