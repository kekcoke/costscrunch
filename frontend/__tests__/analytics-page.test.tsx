/**
 * analytics-page.vitest.test.tsx  (Vite / Vitest)
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
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  // act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// ── Mock API ──────────────────────────────────────────────────────────────────
vi.mock("../src/services/api", () => ({
  analyticsApi: {
    summary: vi.fn(),
    trends: vi.fn(),
    chartData: vi.fn(),
  },
}));

import { analyticsApi } from "../src/services/api";

// ── Fixtures ──────────────────────────────────────────────────────────────────
const MOCK_SUMMARY: ExpenseSummaryStats = {
  totalAmount: 4215.80,
  expenseCount: 47,
  avgPerExpense: 89.70,
  topCategory: "Travel" as CategoryName,
  period: "month",
  currency: "USD",
};

const MOCK_TRENDS = {
  buckets: [
    { period: "2026-01", total: 3200, categories: { Travel: 1200, Meals: 800, Software: 1200 } },
    { period: "2026-02", total: 4100, categories: { Travel: 1500, Meals: 1100, Software: 1500 } },
    { period: "2026-03", total: 4215, categories: { Travel: 1600, Meals: 900,  Software: 1715 } },
  ],
};

const MOCK_CHART_DATA = {
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
    { date: "2026-03-08", amount: 120,  frequency: 8, category: "Meals"  },
    { date: "2026-03-15", amount: 1200, frequency: 1, category: "Software" },
  ],
  stackedBar: MOCK_TRENDS.buckets,
};

// ── Import page under test ────────────────────────────────────────────────────
import AnalyticsPage from "../src/pages/analytics";
import type { CategoryName, ExpenseSummaryStats } from "../src/models/types";

// ── Render helper ─────────────────────────────────────────────────────────────
function renderAnalytics() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.mocked(analyticsApi.summary).mockResolvedValue(MOCK_SUMMARY as any);
  vi.mocked(analyticsApi.trends).mockResolvedValue(MOCK_TRENDS as any);
  vi.mocked(analyticsApi.chartData).mockResolvedValue(MOCK_CHART_DATA as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL RENDER — summary cards + default donut chart
// ─────────────────────────────────────────────────────────────────────────────
describe("AnalyticsPage — initial render", () => {
  it("shows loading skeleton before data resolves", () => {
    vi.mocked(analyticsApi.summary).mockReturnValue(new Promise(() => {}) as any);
    renderAnalytics();
    // Skeleton or spinner must be present
    expect(
      screen.queryByRole("progressbar") || screen.queryByTestId("skeleton")
    ).toBeTruthy();
  });

  it("renders summary stat cards after data loads", async () => {
    renderAnalytics();
    await waitFor(() => expect(screen.getByText(/\$4,215/)).toBeInTheDocument());
    expect(screen.getByText(/47/)).toBeInTheDocument();    // expense count
    expect(screen.getByText(/\$89/)).toBeInTheDocument();  // avg per expense
  });

  it("renders DonutChart as the default chart", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /donut|pie chart/i })).toBeInTheDocument()
    );
  });

  it("donut chart shows category legend labels", async () => {
    renderAnalytics();
    await waitFor(() => expect(screen.getByText("Travel")).toBeInTheDocument());
    expect(screen.getByText("Software")).toBeInTheDocument();
    expect(screen.getByText("Meals")).toBeInTheDocument();
  });

  it("donut chart centre shows total amount", async () => {
    renderAnalytics();
    await waitFor(() => expect(screen.getByText(/\$4,215/)).toBeInTheDocument());
  });

  it("renders chart type toolbar with 4 icons", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    const toolbar = screen.getByRole("toolbar", { name: /chart type/i });
    expect(within(toolbar).getAllByRole("button").length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHART SWITCHING — async rendering via icon toolbar
// ─────────────────────────────────────────────────────────────────────────────
describe("AnalyticsPage — chart switching (async)", () => {
  it("switches to HorizontalBar chart asynchronously", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );

    const barBtn = screen.getByRole("button", { name: /horizontal bar/i });
    await userEvent.click(barBtn);

    // Loading indicator appears during chart transition
    expect(
      screen.queryByRole("progressbar") || screen.queryByTestId("chart-loading")
    ).toBeTruthy();

    // Chart resolves
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /horizontal bar chart/i })).toBeInTheDocument()
    );
  });

  it("horizontal bar chart X-axis label reads 'Amount (USD)'", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /horizontal bar/i }));
    await waitFor(() =>
      expect(screen.getByText(/amount.*usd|usd.*amount/i)).toBeInTheDocument()
    );
  });

  it("horizontal bar chart Y-axis contains category names", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /horizontal bar/i }));
    await waitFor(() => expect(screen.getByText("Software")).toBeInTheDocument());
    expect(screen.getByText("Travel")).toBeInTheDocument();
  });

  it("switches to BubbleChart asynchronously", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /bubble/i }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: /bubble chart/i })).toBeInTheDocument()
    );
  });

  it("bubble chart Y-axis label reads 'Amount (USD)'", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /bubble/i }));
    await waitFor(() =>
      expect(screen.getByText(/amount.*usd|usd.*amount/i)).toBeInTheDocument()
    );
  });

  it("bubble chart X-axis label shows time unit", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /bubble/i }));
    await waitFor(() =>
      expect(screen.getByText(/date|week|month/i)).toBeInTheDocument()
    );
  });

  it("switches to StackedBar chart asynchronously", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /stacked/i }));

    await waitFor(() =>
      expect(screen.getByRole("img", { name: /stacked bar chart/i })).toBeInTheDocument()
    );
  });

  it("stacked bar Y-axis label reads 'Amount (USD)'", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /stacked/i }));
    await waitFor(() =>
      expect(screen.getByText(/amount.*usd|usd.*amount/i)).toBeInTheDocument()
    );
  });

  it("stacked bar X-axis shows time period labels", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /stacked/i }));
    await waitFor(() => expect(screen.getByText(/2026-0[1-3]/)).toBeInTheDocument());
  });

  it("active chart type button has aria-pressed=true", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    // Donut is default
    expect(screen.getByRole("button", { name: /donut|pie/i })).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(screen.getByRole("button", { name: /horizontal bar/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /horizontal bar/i })).toHaveAttribute("aria-pressed", "true")
    );
    expect(screen.getByRole("button", { name: /donut|pie/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls getChartData with current filters on chart switch", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /bubble/i }));
    await waitFor(() =>
      expect(vi.mocked(analyticsApi.chartData)).toHaveBeenCalledWith(
        expect.objectContaining({ chartType: "bubble" })
      )
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────────────────────────────────
describe("AnalyticsPage — filters", () => {
  it("renders period selector with month/quarter/year options", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /period/i })).toBeInTheDocument()
    );
    const select = screen.getByRole("combobox", { name: /period/i }) as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain("month");
    expect(options).toContain("quarter");
    expect(options).toContain("year");
  });

  it("changing period re-fetches summary data", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /period/i })).toBeInTheDocument()
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /period/i }),
      "quarter"
    );

    await waitFor(() =>
      expect(vi.mocked(analyticsApi.summary)).toHaveBeenCalledWith(
        expect.objectContaining({ period: "quarter" })
      )
    );
  });

  it("renders category multi-select filter", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /categories|filter/i })).toBeInTheDocument()
    );
  });

  it("selecting a category filters chart data", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /categories|filter/i })).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /categories|filter/i }));

    const travelCheck = await screen.findByRole("checkbox", { name: /travel/i });
    await userEvent.click(travelCheck);

    await waitFor(() =>
      expect(vi.mocked(analyticsApi.chartData)).toHaveBeenCalledWith(
        expect.objectContaining({ categories: expect.arrayContaining(["Travel"]) })
      )
    );
  });

  it("renders date range from/to inputs", async () => {
    renderAnalytics();
    await waitFor(() => screen.getByLabelText(/from|start date/i));
    expect(screen.getByLabelText(/from|start date/i)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/to|end date/i)).toHaveAttribute("type", "date");
  });

  it("changing date range re-fetches chart data", async () => {
    renderAnalytics();
    await waitFor(() => screen.getByLabelText(/from|start date/i));

    fireEvent.change(screen.getByLabelText(/from|start date/i), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/to|end date/i), {
      target: { value: "2026-03-31" },
    });

    await waitFor(() =>
      expect(vi.mocked(analyticsApi.chartData)).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-01-01", to: "2026-03-31" })
      )
    );
  });

  it("renders currency selector defaulting to USD", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /currency/i })).toBeInTheDocument()
    );
    expect(
      (screen.getByRole("combobox", { name: /currency/i }) as HTMLSelectElement).value
    ).toBe("USD");
  });

  it("renders group toggle: personal / group / all", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("group", { name: /expense scope|context/i })).toBeInTheDocument()
    );
    const scope = screen.getByRole("group", { name: /expense scope|context/i });
    expect(within(scope).getByRole("radio", { name: /personal/i })).toBeInTheDocument();
    expect(within(scope).getByRole("radio", { name: /group/i })).toBeInTheDocument();
    expect(within(scope).getByRole("radio", { name: /all/i })).toBeInTheDocument();
  });

  it("'Reset Filters' button restores defaults", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /period/i })).toBeInTheDocument()
    );

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /period/i }),
      "year"
    );

    await userEvent.click(screen.getByRole("button", { name: /reset.*filter|clear.*filter/i }));

    expect(
      (screen.getByRole("combobox", { name: /period/i }) as HTMLSelectElement).value
    ).toBe("month");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ACCESSIBILITY
// ─────────────────────────────────────────────────────────────────────────────
describe("AnalyticsPage — accessibility", () => {
  it("chart toolbar buttons have descriptive aria-labels", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("toolbar", { name: /chart type/i })).toBeInTheDocument()
    );
    const toolbar = screen.getByRole("toolbar", { name: /chart type/i });
    within(toolbar).getAllByRole("button").forEach(btn => {
      expect(btn).toHaveAttribute("aria-label");
    });
  });

  it("each chart container has role='img' with aria-label", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("img", { name: /chart/i })).toBeInTheDocument()
    );
  });

  it("filter section has region landmark", async () => {
    renderAnalytics();
    await waitFor(() =>
      expect(screen.getByRole("region", { name: /filters/i })).toBeInTheDocument()
    );
  });
});