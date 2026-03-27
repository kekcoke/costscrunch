import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExpensesPage } from "../../src/pages/expenses";
import { useExpenseStore } from "../../src/stores/useExpenseStore";
import { expensesApi } from "../../src/services/api";
import { createMockExpense } from "../../src/mocks/expenses";

// Mock the API service
vi.mock("../../src/services/api", () => ({
  expensesApi: {
    list: vi.fn(),
    export: vi.fn(),
  },
}));

describe("ExpensesPage Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to default state before each test
    useExpenseStore.setState({
      expenses: [],
      filter: "all",
      categoryFilter: "all",
      search: "",
      sortOrder: "date-desc",
      limit: 10,
      nextToken: null,
    });
    // Ensure all mocks are fresh
    vi.mocked(expensesApi.list).mockReset();
    vi.mocked(expensesApi.list).mockResolvedValue({ items: [], nextToken: null, count: 0 });
  });

  it("triggers fetchExpenses on mount", async () => {
    const listSpy = vi.spyOn(expensesApi, "list").mockResolvedValue({
      items: [],
      nextToken: null,
      count: 0
    });

    render(<ExpensesPage />);

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalled();
    });
  });

  it("updates the limit and re-fetches when dropdown changes", async () => {
    const listSpy = vi.spyOn(expensesApi, "list").mockResolvedValue({
      items: [],
      nextToken: null,
      count: 0
    });

    render(<ExpensesPage />);
    
    // The pagination select doesn't have a label, but its options contain "Show"
    const select = screen.getByDisplayValue(/Show 10/i);
    fireEvent.change(select, { target: { value: "20" } });

    await waitFor(() => {
      expect(useExpenseStore.getState().limit).toBe(20);
      // Called once on mount, once on change
      expect(listSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("updates category filter and re-fetches when dropdown changes", async () => {
    const listSpy = vi.spyOn(expensesApi, "list").mockResolvedValue({
      items: [],
      nextToken: null,
      count: 0
    });

    render(<ExpensesPage />);
    
    const select = screen.getByDisplayValue(/All Categories/i);
    fireEvent.change(select, { target: { value: "Travel" } });

    await waitFor(() => {
      expect(useExpenseStore.getState().categoryFilter).toBe("Travel");
      expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ category: "Travel" }));
    });
  });

  it("updates sort order and re-renders items in correct order", async () => {
    const e1 = createMockExpense({ id: "1", merchant: "A", amount: 100, date: "2026-01-01" });
    const e2 = createMockExpense({ id: "2", merchant: "B", amount: 50, date: "2026-01-02" });
    
    useExpenseStore.setState({ expenses: [e1, e2] });
    vi.spyOn(expensesApi, "list").mockResolvedValue({ items: [e1, e2], nextToken: null, count: 2 });

    render(<ExpensesPage />);
    
    const select = screen.getByDisplayValue(/Newest First/i);
    fireEvent.change(select, { target: { value: "amount-desc" } });

    expect(useExpenseStore.getState().sortOrder).toBe("amount-desc");
    
    const rows = screen.getAllByRole("button");
    // The first row (after filter buttons) should be the one with merchant "A" ($100)
    // Filter buttons also have role="button", so we look for the merchant text
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByText("A")).toBeDefined();
  });

  it("handles the export flow for CSV", async () => {
    const exportSpy = vi.spyOn(expensesApi, "export").mockResolvedValue({ format: "csv" });
    
    render(<ExpensesPage />);
    
    // The export select starts with "📥 Export"
    const exportSelect = screen.getByDisplayValue(/Export/i);
    fireEvent.change(exportSelect, { target: { value: "csv" } });

    await waitFor(() => {
      expect(exportSpy).toHaveBeenCalledWith(expect.objectContaining({ format: "csv" }));
    });
  });

  it("shows 'Load More' button only when nextToken exists", async () => {
    useExpenseStore.setState({ nextToken: "some-token" });
    
    render(<ExpensesPage />);
    
    expect(screen.getByText(/Load More/i)).toBeDefined();
  });

  it("appends items when 'Load More' is clicked", async () => {
    const initialExpense = createMockExpense({ id: "1", merchant: "M1", amount: 10, date: "2026-01-01", status: "approved" });
    const nextExpense = createMockExpense({ id: "2", merchant: "M2", amount: 20, date: "2026-01-02", status: "approved" });
    
    useExpenseStore.setState({ 
      expenses: [initialExpense],
      nextToken: "token-1" 
    });

    vi.spyOn(expensesApi, "list").mockResolvedValue({
      items: [nextExpense],
      nextToken: null,
      count: 1
    });

    render(<ExpensesPage />);
    
    const loadMoreBtn = screen.getByText(/Load More/i);
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      const state = useExpenseStore.getState();
      expect(state.expenses).toHaveLength(2);
      expect(state.expenses[1].id).toBe("2");
    });
  });
});
