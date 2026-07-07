import { describe, it, expect } from "vitest";
import { createExpenseFromForm } from "../../src/helpers/expense/createExpenseFromForm";
import type { ScanForm } from "../../src/models/scanForm";

const BASE_FORM: ScanForm = {
  merchant: "Whole Foods",
  amount: "42.50",
  category: "Groceries",
  date: "2026-03-01",
  notes: "Weekly shop",
};

describe("createExpenseFromForm", () => {
  it("maps form fields onto the expense shape", () => {
    const result = createExpenseFromForm(BASE_FORM, "manual", "user-9", "Jane");

    expect(result.merchant).toBe("Whole Foods");
    expect(result.amount).toBe(42.5);
    expect(result.category).toBe("Groceries");
    expect(result.date).toBe("2026-03-01");
    expect(result.notes).toBe("Weekly shop");
    expect(result.description).toBe("Weekly shop");
    expect(result.ownerId).toBe("user-9");
    expect(result.addedBy).toBe("Jane");
  });

  it("parses a non-numeric amount as 0", () => {
    const result = createExpenseFromForm({ ...BASE_FORM, amount: "not-a-number" }, "manual");
    expect(result.amount).toBe(0);
    expect(result.amountUSD).toBe(0);
  });

  it("defaults ownerId and addedBy when not provided", () => {
    const result = createExpenseFromForm(BASE_FORM, "manual");
    expect(result.ownerId).toBe("user1");
    expect(result.addedBy).toBe("You");
  });

  it("marks receipt true and source 'scan' when stage is 'result'", () => {
    const result = createExpenseFromForm(BASE_FORM, "result");
    expect(result.receipt).toBe(true);
    expect(result.source).toBe("scan");
  });

  it("marks receipt false and source 'manual' for any non-result stage", () => {
    const result = createExpenseFromForm(BASE_FORM, "manual");
    expect(result.receipt).toBe(false);
    expect(result.source).toBe("manual");
  });

  it("sets sensible defaults for status, currency, and financial flags", () => {
    const result = createExpenseFromForm(BASE_FORM, "manual");
    expect(result.status).toBe("pending");
    expect(result.currency).toBe("USD");
    expect(result.exchangeRate).toBe(1.0);
    expect(result.reimbursable).toBe(true);
    expect(result.billable).toBe(false);
    expect(result.tags).toEqual([]);
    expect(result.splits).toEqual([]);
    expect(result.groupId).toBeNull();
  });
});
