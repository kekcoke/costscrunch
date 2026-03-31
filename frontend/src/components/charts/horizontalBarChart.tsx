// ─── CostsCrunch — HorizontalBarChart ──────────────────────────────────────────
// Tests verify:
//   - role="img" aria-label=/horizontal bar chart/i
//   - X-axis label "Amount (USD)"
//   - Y-axis contains category names (Software, Travel, Meals…)

import { fmt } from "../../helpers/utils.js";
import { CATEGORIES, type Category } from "../../models/constants.js";

interface BarDataPoint {
  category: string;
  amount:   number;
}

interface Props {
  data:     BarDataPoint[];
  currency?: string;
}

export default function HorizontalBarChart({ data, currency = "USD" }: Props) {
  if (!data || data.length === 0) {
    return (
      <div style={{ color: "var(--color-text-dim)", textAlign: "center", padding: "60px" }}>
        No data available
      </div>
    );
  }

  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  const max    = sorted[0]?.amount ?? 1;
  const axisLabel = `Amount (${currency})`;

  return (
    <div
      role="img"
      aria-label={`Horizontal bar chart — ${axisLabel}`}
      style={{ width: "100%", fontFamily: "var(--font-body)" }}
    >
      {/* X-axis label */}
      <div
        style={{
          textAlign: "center",
          fontSize: "11px",
          fontWeight: 600,
          color: "var(--color-text-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          marginBottom: "24px",
        }}
      >
        {axisLabel}
      </div>

      {/* Bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {sorted.map((d, i) => {
          const cat   = CATEGORIES[d.category as Category] ?? CATEGORIES.Other;
          const pct   = (d.amount / max) * 100;
          const delay = i * 0.04;

          return (
            <div key={d.category} style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              {/* Y-axis: category label */}
              <div
                style={{
                  width: "90px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--color-text-muted)",
                  textAlign: "right",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: "6px",
                }}
              >
                <span>{cat.icon}</span>
                {d.category}
              </div>

              {/* Bar track */}
              <div
                style={{
                  flex: 1,
                  height: "28px",
                  background: "var(--color-surface-2)",
                  borderRadius: "6px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, ${cat.color}cc, ${cat.color})`,
                    borderRadius: "6px",
                    animation: `expandX 0.7s ${delay}s both cubic-bezier(0.34,1.56,0.64,1)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: "10px",
                  }}
                >
                  {pct > 25 && (
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>
                      {fmt(d.amount)}
                    </span>
                  )}
                </div>
              </div>

              {/* Value (shown outside bar when bar is narrow) */}
              {pct <= 25 && (
                <div style={{ fontSize: "12px", fontWeight: 700, color: cat.color, flexShrink: 0, width: "70px" }}>
                  {fmt(d.amount)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes expandX {
          from { width: 0; }
        }
      `}</style>
    </div>
  );
}