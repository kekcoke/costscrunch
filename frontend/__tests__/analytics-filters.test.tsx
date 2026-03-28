import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import AnalyticsPage from "../src/pages/analytics";
import { BrowserRouter } from "react-router-dom";

// Mock the API with valid data shapes to prevent chart component crashes
vi.mock("../src/services/api.js", () => ({
  analyticsApi: {
    summary: vi.fn().mockResolvedValue({
      totalAmount: 0,
      expenseCount: 0,
      avgPerExpense: 0,
      topCategory: "None",
      period: "month",
      currency: "USD",
    }),
    chartData: vi.fn().mockResolvedValue({
      donut: [],
      horizontalBar: [],
      bubble: [],
      stackedBar: [],
    }),
  },
}));

const renderPage = async () => {
  await act(async () => {
    render(
      <BrowserRouter>
        <AnalyticsPage />
      </BrowserRouter>
    );
  });
};

describe("Analytics Filters UI", () => {
  it("shows check icon when category is selected and renders a removal tag", async () => {
    await renderPage();

    // 1. Open dropdown
    const dropBtn = screen.getByLabelText(/Categories filter/i);
    await act(async () => {
      fireEvent.click(dropBtn);
    });

    // 2. Select 'Office' from the dropdown list
    const officeLabel = screen.getByText("Office");
    await act(async () => {
      fireEvent.click(officeLabel);
    });

    // 3. Verify check icon in dropdown (UI contains checkmark text)
    expect(within(officeLabel).getByText("✓")).toBeInTheDocument();

    // 4. Verify tag appears in the filter section (outside the dropdown menu)
    // We look for the tag in the region labeled "Filters"
    const filterRegion = screen.getByRole("region", { name: /Filters/i });
    const removeBtn = within(filterRegion).getByLabelText(/Remove Office/i);
    expect(removeBtn).toBeInTheDocument();

    // 5. Remove via tag button
    await act(async () => {
      fireEvent.click(removeBtn);
    });

    // 6. Verify tag is removed
    expect(within(filterRegion).queryByLabelText(/Remove Office/i)).not.toBeInTheDocument();

    // 7. Re-open dropdown and verify check icon is gone
    // (It might still be open, but we click to ensure state visibility)
    const officeLabelAfter = screen.getByText("Office");
    expect(within(officeLabelAfter).queryByText("✓")).toBeNull();
  });
});
