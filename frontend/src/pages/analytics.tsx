// ─── CostsCrunch — AnalyticsPage ─────────────────────────────────────────────
import { useState, useEffect, useCallback, lazy, Suspense, useMemo } from "react";
import { analyticsApi } from "../services/api.js";

import { useExpenseStore, selectExpenses } from "../stores/useExpenseStore";
import { CATEGORIES } from "../models/constants";
import { fmt } from "../helpers/utils";
import StatCard from "../components/StatCard.jsx";
import { DonutChart } from "../components";

// ── Lazy chart components (async rendering) ───────────────────────────────────
const HorizontalBarChart = lazy(() => import("../components/charts/horizontalBarChart.js"));
const BubbleChart        = lazy(() => import("../components/charts/bubbleChart.js"));
const StackedBarChart    = lazy(() => import("../components/charts/stackedBarChart.js"));
 
const TREND_MONTHS = ["Oct", "Nov", "Dec", "Jan", "Feb"] as const;
const TREND_HISTORICAL = [2100, 3400, 4800, 2900]; // all except current month

interface Filters {
  period:     Period;
  categories: string[];
  from:       string;
  to:         string;
  currency:   "USD" | "EUR" | "GBP";
  scope:      Scope;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ChartType = "donut" | "horizontalBar" | "bubble" | "stackedBar";
type Period    = "month" | "quarter" | "year";
type Scope     = "personal" | "group" | "all";

const DEFAULT_FILTERS: Filters = {
  period:     "month",
  categories: [],
  from:       "",
  to:         "",
  currency:   "USD",
  scope:      "all",
};
 
const CHART_TYPES: Array<{ type: ChartType; label: string; icon: string }> = [
  { type: "donut",         label: "Donut / Pie chart",        icon: "◔" },
  { type: "horizontalBar", label: "Horizontal bar chart",     icon: "≡" },
  { type: "bubble",        label: "Bubble chart",             icon: "⊙" },
  { type: "stackedBar",    label: "Stacked bar chart",        icon: "▦" },
];
 
const ALL_CATEGORIES = Object.keys(CATEGORIES);

// ── Chart loading spinner ─────────────────────────────────────────────────────
function ChartLoader() {
  return (
    <div
      role="progressbar"
      aria-label="Loading chart"
      data-testid="chart-loading"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "300px",
        gap: "12px",
        color: "var(--color-text-dim)",
      }}
    >
      <span
        style={{
          width: "20px",
          height: "20px",
          border: "2px solid var(--color-border)",
          borderTopColor: "#6366f1",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
          flexShrink: 0,
        }}
      />
      Rendering chart…
    </div>
  );
}

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