// ─── CostsCrunch — AnalyticsPage ─────────────────────────────────────────────
import { useState, useEffect, useCallback, lazy, Suspense, useMemo } from "react";
import { analyticsApi } from "../services/api.js";

import { CATEGORIES } from "../models/constants";
import { fmt } from "../helpers/utils";
import DonutChart from "../components/charts/donutChart";
import type { AnalyticsChartData, AnalyticsQuery, ExpenseSummaryStats } from "../models/types";

// ── Lazy chart components (async rendering) ───────────────────────────────────
const HorizontalBarChart = lazy(() => import("../components/charts/horizontalBarChart"));
const BubbleChart = lazy(() => import("../components/charts/bubbleChart"));
const StackedBarChart = lazy(() => import("../components/charts/stackedBarChart"));

interface Filters {
  period: Period;
  categories: string[];
  from: string;
  to: string;
  currency: "USD" | "EUR" | "GBP";
  scope: Scope;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ChartType = "donut" | "horizontalBar" | "bubble" | "stackedBar";
type Period = "month" | "quarter" | "year";
type Scope = "personal" | "group" | "all";

const DEFAULT_FILTERS: Filters = {
  period: "month",
  categories: [],
  from: "",
  to: "",
  currency: "USD",
  scope: "all",
};

const CHART_TYPES: Array<{ type: ChartType; label: string; icon: string }> = [
  { type: "donut", label: "Donut / Pie chart", icon: "◔" },
  { type: "horizontalBar", label: "Horizontal bar chart", icon: "≡" },
  { type: "bubble", label: "Bubble chart", icon: "⊙" },
  { type: "stackedBar", label: "Stacked bar chart", icon: "▦" },
];

const CATEGORY_NAMES = Object.keys(CATEGORIES);

// Fallback data ensures stable UI in offline/dev/error states.
const MOCK_CHART_DATA: AnalyticsChartData = {
  donut: [
    { label: "Travel", value: 1600, color: "#6366f1" },
    { label: "Meals", value: 900, color: "#f59e0b" },
    { label: "Software", value: 1715, color: "#8b5cf6" },
  ],
  horizontalBar: [
    { category: "Software", amount: 1715 },
    { category: "Travel", amount: 1600 },
    { category: "Meals", amount: 900 },
  ],
  bubble: [
    { date: "2026-03-01", amount: 450, frequency: 3, category: "Travel" },
    { date: "2026-03-08", amount: 120, frequency: 8, category: "Meals" },
    { date: "2026-03-15", amount: 1200, frequency: 1, category: "Software" },
  ],
  stackedBar: [
    { period: "2026-01", total: 3200, categories: { Travel: 1200, Meals: 800, Software: 1200 } },
    { period: "2026-02", total: 4100, categories: { Travel: 1500, Meals: 1100, Software: 1500 } },
    { period: "2026-03", total: 4215, categories: { Travel: 1600, Meals: 900, Software: 1715 } },
  ],
};

const MOCK_SUMMARY: ExpenseSummaryStats = {
  totalAmount: 4215.8,
  expenseCount: 47,
  avgPerExpense: 89.7,
  topCategory: "Travel",
  period: "month",
  currency: "USD",
};

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

export default function AnalyticsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedChart, setSelectedChart] = useState<ChartType>("donut");
  const [apiChartData, setApiChartData] = useState<AnalyticsChartData | null>(null);
  const [summary, setSummary] = useState<ExpenseSummaryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);

  const chartQuery = useMemo<AnalyticsQuery>(
    () => ({
      period: filters.period,
      categories: filters.categories,
      from: filters.from || undefined,
      to: filters.to || undefined,
      currency: filters.currency,
      scope: filters.scope,
      chartType: selectedChart,
    }),
    [filters, selectedChart]
  );

  const handleChartTypeSelect = useCallback((type: ChartType) => {
    setSelectedChart((prev) => (prev === type ? prev : type));
  }, []);

  const handlePeriodChange = useCallback((value: Period) => {
    setFilters((prev) => (prev.period === value ? prev : { ...prev, period: value }));
  }, []);

  const handleCurrencyChange = useCallback((value: Filters["currency"]) => {
    setFilters((prev) => (prev.currency === value ? prev : { ...prev, currency: value }));
  }, []);

  const handleScopeChange = useCallback((value: Scope) => {
    setFilters((prev) => (prev.scope === value ? prev : { ...prev, scope: value }));
  }, []);

  const handleDateChange = useCallback((key: "from" | "to", value: string) => {
    setFilters((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setFilters((prev) => {
      const exists = prev.categories.includes(category);
      const nextCategories = exists
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category];
      return { ...prev, categories: nextCategories };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      setChartError(null);

      try {
        const [summaryRes, chartRes] = await Promise.all([
          analyticsApi.summary(chartQuery),
          analyticsApi.chartData(chartQuery),
        ]);

        if (!cancelled) {
          setSummary(summaryRes);
          setApiChartData(chartRes);
        }
      } catch {
        if (!cancelled) {
          setSummary(MOCK_SUMMARY);
          setApiChartData(MOCK_CHART_DATA);
          setChartError("Using fallback chart data.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [chartQuery]);

  const effectiveChartData = useMemo(() => apiChartData ?? MOCK_CHART_DATA, [apiChartData]);
  const effectiveSummary = useMemo(() => summary ?? MOCK_SUMMARY, [summary]);

  const chartTitle = useMemo(
    () => CHART_TYPES.find((c) => c.type === selectedChart)?.label ?? "Chart",
    [selectedChart]
  );

  return (
    <div style={{ animation: "fadeUp 0.4s both" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
        <section
          role="region"
          aria-label="Filters"
          style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "18px" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "10px" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Period
              <select
                aria-label="Period"
                value={filters.period}
                onChange={(e) => handlePeriodChange(e.target.value as Period)}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px" }}
              >
                <option value="month">month</option>
                <option value="quarter">quarter</option>
                <option value="year">year</option>
              </select>
            </label>

            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Categories
              <button
                type="button"
                onClick={() => setShowCategoryMenu((v) => !v)}
                aria-label="Categories filter"
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px", textAlign: "left" }}
              >
                {filters.categories.length ? `${filters.categories.length} selected` : "Select categories"}
              </button>
              {showCategoryMenu && (
                <div style={{ position: "absolute", top: "56px", left: 0, zIndex: 20, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "10px", padding: "10px", minWidth: "180px" }}>
                  {CATEGORY_NAMES.map((name) => (
                    <label key={name} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--color-text)", marginBottom: "6px" }}>
                      <input
                        type="checkbox"
                        checked={filters.categories.includes(name)}
                        onChange={() => toggleCategory(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              From
              <input
                aria-label="From"
                type="date"
                value={filters.from}
                onChange={(e) => handleDateChange("from", e.target.value)}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              To
              <input
                aria-label="To"
                type="date"
                value={filters.to}
                onChange={(e) => handleDateChange("to", e.target.value)}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px" }}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: "10px", marginTop: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              Currency
              <select
                aria-label="Currency"
                value={filters.currency}
                onChange={(e) => handleCurrencyChange(e.target.value as Filters["currency"])}
                style={{ background: "var(--color-surface-2)", color: "var(--color-text)", border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px" }}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </label>

            <fieldset
              role="group"
              aria-label="Expense scope"
              style={{ border: "1px solid var(--color-border)", borderRadius: "8px", padding: "6px 10px", display: "flex", gap: "10px" }}
            >
              <label style={{ fontSize: "12px" }}>
                <input type="radio" name="scope" checked={filters.scope === "personal"} onChange={() => handleScopeChange("personal")} /> personal
              </label>
              <label style={{ fontSize: "12px" }}>
                <input type="radio" name="scope" checked={filters.scope === "group"} onChange={() => handleScopeChange("group")} /> group
              </label>
              <label style={{ fontSize: "12px" }}>
                <input type="radio" name="scope" checked={filters.scope === "all"} onChange={() => handleScopeChange("all")} /> all
              </label>
            </fieldset>

            <button
              type="button"
              onClick={resetFilters}
              aria-label="Reset Filters"
              style={{ marginLeft: "auto", border: "1px solid var(--color-border)", background: "var(--color-surface-2)", color: "var(--color-text)", borderRadius: "8px", padding: "6px 10px" }}
            >
              Reset Filters
            </button>
          </div>
        </section>

        <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "16px" }}>Analytics Charts</div>
            <div style={{ fontSize: "13px", color: "var(--color-text-dim)" }}>
              Showing: <strong style={{ color: "var(--color-text)" }}>{chartTitle}</strong>
            </div>
          </div>

          <div
            role="toolbar"
            aria-label="Chart type"
            style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "18px" }}
          >
            {CHART_TYPES.map((chart) => (
              <button
                key={chart.type}
                type="button"
                aria-label={chart.label}
                aria-pressed={selectedChart === chart.type}
                onClick={() => handleChartTypeSelect(chart.type)}
                style={{
                  border: selectedChart === chart.type ? "1px solid #6366f1" : "1px solid var(--color-border)",
                  background: selectedChart === chart.type ? "rgba(99,102,241,0.14)" : "var(--color-surface-2)",
                  color: "var(--color-text)",
                  borderRadius: "10px",
                  padding: "8px 10px",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                }}
              >
                <span aria-hidden="true">{chart.icon}</span>
                {chart.label}
              </button>
            ))}
          </div>

          {chartError && (
            <div style={{ marginBottom: "10px", fontSize: "12px", color: "var(--color-text-dim)" }}>
              {chartError}
            </div>
          )}

          {loading ? (
            <ChartLoader />
          ) : (
            <Suspense fallback={<ChartLoader />}>
              {selectedChart === "donut" && <DonutChart data={effectiveChartData.donut} />}
              {selectedChart === "horizontalBar" && (
                <HorizontalBarChart data={effectiveChartData.horizontalBar} currency={filters.currency} />
              )}
              {selectedChart === "bubble" && (
                <BubbleChart data={effectiveChartData.bubble} currency={filters.currency} period={filters.period} />
              )}
              {selectedChart === "stackedBar" && (
                <StackedBarChart data={effectiveChartData.stackedBar} currency={filters.currency} />
              )}
            </Suspense>
          )}
        </section>

        <section style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "16px", padding: "20px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "14px", marginBottom: "10px" }}>Summary</div>
          <div style={{ fontSize: "22px", fontWeight: 800, color: "#0ea5e9", fontFamily: "var(--font-display)" }}>
            {fmt(effectiveSummary.totalAmount)}
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "4px" }}>
            {effectiveSummary.expenseCount} expenses
          </div>
          <div style={{ fontSize: "12px", color: "var(--color-text-dim)", marginTop: "2px" }}>
            Avg {fmt(effectiveSummary.avgPerExpense)} per expense
          </div>
        </section>
      </div>
    </div>
  );
}
