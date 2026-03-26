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
      search: "",
      limit: 10,
      nextToken: null,
    });
  });

  it("triggers fetchExpenses on mount", async () => {
    const listSpy = vi.spyOn(expensesApi, "list").mockResolvedValue({
      items: [],
      nextToken: null,
      count: 0
    });

    render(<ExpensesPage />);

    expect(listSpy).toHaveBeenCalled();
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

    expect(useExpenseStore.getState().limit).toBe(20);
    // Called once on mount, once on change
    expect(listSpy).toHaveBeenCalledTimes(2);
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
