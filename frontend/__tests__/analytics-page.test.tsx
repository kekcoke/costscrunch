/**
 * analytics-page.vitest.test.tsx  (Vite / Vitest)]
 * @vitest-environment jsdom
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for the enhanced AnalyticsPage featuring:
 *
 *   Charts (rendered asynchronously via icon toolbar):
 *     • DonutChart      — default, category spend distribution
 *     • HorizontalBar   — category vs amount, sorted descending
 *     • BubbleChart     — scatter: x=date, y=amount, r=frequency
 *     • StackedBar      — period buckets, stacked by category
 *
 *   Axes / labels:
 *     • Y-axis: amount (USD), formatted "$N,NNN"
 *     • X-axis: time unit (day | week | month | quarter | year)
 *
 *   Filters:
 *     • Period selector  (month | quarter | year)
 *     • Category picker  (multi-select checkboxes)
 *     • Date range       (from / to date inputs)
 *     • Currency         (USD | EUR | GBP)
 *     • Group toggle     (personal | group | all)
 *
 * Patterns used:
 *   - vi.mock() for API layer
 *   - waitFor() for async chart transitions
 *   - Recharts SVG assertions (role="img", aria-label on chart containers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AnalyticsPage from "../src/pages/analytics";

// ── Mock API ──────────────────────────────────────────────────────────────────
const mockSummary = {
  totalAmount: 4215.80,
  expenseCount: 47,
  avgPerExpense: 89.70,
  topCategory: "Travel",
  period: "month",
  currency: "USD",
};

const mockChartData = {
  donut: [
    { label: "Travel",   value: 1600, color: "#6366f1" },
    { label: "Meals",    value: 900,  color: "#f59e0b" },
    { label: "Software", value: 1715, color: "#8b5cf6" },
  ],
  horizontalBar: [
    { category: "Software", amount: 1715 },
    { category: "Travel",   amount: 1600 },
    { category: "Meals",    amount: 900  },
  ],
  bubble: [
    { date: "2026-03-01", amount: 450,  frequency: 3, category: "Travel" },
  ],
  stackedBar: [],
};

// Use vi.hoisted to ensure mocks are ready before imports
const { analyticsApiMock } = vi.hoisted(() => ({
  analyticsApiMock: {
    summary: vi.fn(),
    trends: vi.fn(),
    chartData: vi.fn(),
  }
}));

vi.mock("../src/services/api", () => ({
  analyticsApi: analyticsApiMock
}));

// ── Render helper ─────────────────────────────────────────────────────────────
function renderAnalytics() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>
  );
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    analyticsApiMock.summary.mockResolvedValue(mockSummary);
    analyticsApiMock.trends.mockResolvedValue({ buckets: [] });
    analyticsApiMock.chartData.mockResolvedValue(mockChartData);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders summary stat cards after data loads", async () => {
    const { findByText } = renderAnalytics();
    expect(await findByText(/\$4,215/)).toBeInTheDocument();
    expect(await findByText(/47/)).toBeInTheDocument();
  });

  it("renders DonutChart as the default chart", async () => {
    const { findByRole } = renderAnalytics();
    expect(await findByRole("img", { name: /donut|pie chart/i })).toBeInTheDocument();
  });

  it("donut chart shows category legend labels", async () => {
    const { findByText } = renderAnalytics();
    expect(await findByText("Travel")).toBeInTheDocument();
    expect(await findByText("Software")).toBeInTheDocument();
  });

  it("switches to HorizontalBar chart asynchronously", async () => {
    const { findByRole, findByTestId, queryByRole, queryByTestId } = renderAnalytics();
    const toolbar = await findByRole("toolbar", { name: /chart type/i });
    const barBtn = within(toolbar).getByRole("button", { name: /horizontal bar/i });
    
    await userEvent.click(barBtn);
    
    await waitFor(() => {
      expect(queryByRole("progressbar") || queryByTestId("chart-loading")).toBeTruthy();
    });

    expect(await findByRole("img", { name: /horizontal bar chart/i })).toBeInTheDocument();
  });

  it("renders period selector with month/quarter/year options", async () => {
    const { findByRole } = renderAnalytics();
    const select = await findByRole("combobox", { name: /period/i }) as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain("month");
    expect(options).toContain("quarter");
    expect(options).toContain("year");
  });

  it("renders category multi-select filter", async () => {
    const { findByRole } = renderAnalytics();
    // Use a stricter regex to avoid matching "Reset Filters"
    expect(await findByRole("button", { name: /^categories filter$/i })).toBeInTheDocument();
  });
});
