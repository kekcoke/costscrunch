// ─── CostsCrunch — AnalyticsPage ─────────────────────────────────────────────
import { useMemo } from "react";
import { useExpenseStore, selectExpenses } from "../stores/useExpenseStore";
import { CATEGORIES } from "../models/constants";
import { fmt } from "../helpers/utils";
import { DonutChart } from "../components";

const TREND_MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb"] as const;
const TREND_HISTORICAL = [2100, 3400, 4800, 2900]; // all except current month

export function AnalyticsPage() {
  const expenses = useExpenseStore(selectExpenses);

  const totalMonth = useMemo(
    () => expenses.reduce((s, e) => s + e.amount, 0),
    [expenses]
  );

  const catData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) map[e.category] = (map[e.category] ?? 0) + e.amount;
    return Object.entries(map)
      .map(([label, value]) => ({
        label,
        value,
        color: CATEGORIES[label as keyof typeof CATEGORIES]?.color ?? "#64748b",
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [expenses]);

  const trendVals = [...TREND_HISTORICAL, totalMonth];
  const trendMax  = Math.max(...trendVals);

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "28px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", marginBottom: "24px" }}>Spending by Category</div>
          <DonutChart data={catData} />
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "28px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", marginBottom: "24px" }}>Monthly Trend</div>
          {TREND_MONTHS.map((m, i) => {
            const pct = (trendVals[i] / trendMax) * 100;
            const isCurrent = i === TREND_MONTHS.length - 1;
            return (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-dim)", width: "28px" }}>{m}</span>
                <div style={{ flex: 1, height: "10px", background: "var(--color-surface-2)", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: isCurrent ? "linear-gradient(90deg,#0ea5e9,#6366f1)" : "#1e3048", borderRadius: "5px", transition: "width 1s ease" }} />
                </div>
                <span style={{ fontSize: "12px", fontWeight: 700, color: isCurrent ? "#0ea5e9" : "#64748b", width: "70px", textAlign: "right" }}>
                  {fmt(trendVals[i])}
                </span>
              </div>
            );
          })}
        </div>

        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "28px", gridColumn: "1 / -1" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px", marginBottom: "20px" }}>Receipt Scan Stats</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "20px" }}>
            {(
              [
                { label: "Scanned this month", value: "47",  icon: "📷", color: "#0ea5e9" },
                { label: "Avg confidence",     value: "94%", icon: "🎯", color: "#10b981" },
                { label: "Auto-categorized",   value: "91%", icon: "🤖", color: "#8b5cf6" },
                { label: "Manual corrections", value: "4",   icon: "✏️", color: "#f59e0b" },
              ] as const
            ).map((s) => (
              <div key={s.label} style={{ background: "var(--color-surface-2)", borderRadius: "12px", padding: "20px", textAlign: "center" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>{s.icon}</div>
                <div style={{ fontSize: "24px", fontWeight: 800, color: s.color, fontFamily: "var(--font-display)" }}>{s.value}</div>
                <div style={{ fontSize: "11px", color: "var(--color-text-dim)", marginTop: "4px" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}