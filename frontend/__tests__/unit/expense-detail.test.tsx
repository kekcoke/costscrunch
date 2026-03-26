import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExpenseDetail from "../../src/components/expenseDetail";
import { createMockExpense } from "../../src/mocks/expenses";
import { expensesApi } from "../../src/services/api";

// Mock API
vi.mock("../../src/services/api", () => ({
  expensesApi: {
    update: vi.fn(),
  },
}));

describe("ExpenseDetail Component", () => {
  const mockOnBack = vi.fn();
  const mockOnUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders expense information correctly", () => {
    const expense = createMockExpense({
      merchant: "Test Merchant",
      amount: 50.0,
      status: "pending",
      description: "Test Description"
    });

    render(
      <ExpenseDetail 
        expense={expense} 
        onBack={mockOnBack} 
        onUpdate={mockOnUpdate} 
      />
    );

    expect(screen.getByText("Test Merchant")).toBeDefined();
    expect(screen.getByText("$50.00")).toBeDefined();
    expect(screen.getByDisplayValue("Test Description")).toBeDefined();
  });

  it("disables fields when status is approved", () => {
    const expense = createMockExpense({
      status: "approved",
    });

    render(
      <ExpenseDetail 
        expense={expense} 
        onBack={mockOnBack} 
        onUpdate={mockOnUpdate} 
      />
    );

    const descriptionField = screen.getByLabelText(/Description/i);
    expect(descriptionField).toBeDisabled();
    expect(screen.queryByText(/Save Changes/i)).toBeNull();
    expect(screen.getByText(/cannot be edited/i)).toBeDefined();
  });

  it("calls update API and onUpdate when form is submitted", async () => {
    const expense = createMockExpense({
      id: "exp-123",
      status: "pending",
      merchant: "Old Merchant"
    });
    const updatedExpense = { ...expense, merchant: "New Merchant" };
    
    (expensesApi.update as any).mockResolvedValue(updatedExpense);

    render(
      <ExpenseDetail 
        expense={expense} 
        onBack={mockOnBack} 
        onUpdate={mockOnUpdate} 
      />
    );

    const saveButton = screen.getByText(/Save Changes/i);
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(expensesApi.update).toHaveBeenCalledWith("exp-123", expect.any(Object));
      expect(mockOnUpdate).toHaveBeenCalledWith(updatedExpense);
    });
  });

  it("triggers onBack when back button is clicked", () => {
    const expense = createMockExpense();

    render(
      <ExpenseDetail 
        expense={expense} 
        onBack={mockOnBack} 
        onUpdate={mockOnUpdate} 
      />
    );

    fireEvent.click(screen.getByText(/Back to list/i));
    expect(mockOnBack).toHaveBeenCalled();
  });
});
