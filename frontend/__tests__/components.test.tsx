/**
 * components.test.tsx  (Vite / Vitest)
 * ─────────────────────────────────────────────────────────────────────────────
 * Same component coverage as the CRA version but using Vitest APIs.
 * Vitest is API-compatible with Jest for most cases, with a few differences:
 *   - vi.fn() instead of jest.fn()
 *   - vi.useFakeTimers() / vi.useRealTimers()
 *   - No jest.mock hoisting — use vi.mock() at the top of the file
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { selectFiltered, useExpenseStore } from "./../src/stores/useExpenseStore";
import StatCard   from "../src/components/StatCard";
import ExpenseRow from "../src/components/ExpenseRow";
import DonutChart from "../src/components/DonutChart";
import ScanModal  from "../src/components/ScanModal";
import { MOCK_EXPENSES } from "../src/mocks/expenses";

// ─────────────────────────────────────────────────────────────────────────────
const EXPENSE_APPROVED = MOCK_EXPENSES[1];
const EXPENSE_PENDING = MOCK_EXPENSES[2];
const DONUT_DATA = [
  { label: "Travel",   value: 450,  color: "#6366f1" },
  { label: "Meals",    value: 287,  color: "#f59e0b" },
  { label: "Software", value: 1200, color: "#8b5cf6" },
];

// ── StatCard ──────────────────────────────────────────────────────────────────
describe("<StatCard />", () => {
  it("renders label and value", () => {
    render(<StatCard label="Month Total" value="$2,041.70" />);
    expect(screen.getByText("Month Total")).toBeInTheDocument();
    expect(screen.getByText("$2,041.70")).toBeInTheDocument();
  });

  it("renders optional sub-text", () => {
    render(<StatCard label="Pending" value="3" sub="$287.50 to approve" />);
    expect(screen.getByText("$287.50 to approve")).toBeInTheDocument();
  });

  it("omits sub element when not provided", () => {
    render(<StatCard label="Groups" value="3" />);
    expect(screen.queryByText(/to approve/)).not.toBeInTheDocument();
  });
});

// ── ExpenseRow ────────────────────────────────────────────────────────────────
describe("<ExpenseRow />", () => {
  it("renders merchant and amount", () => {
    render(<ExpenseRow expense={EXPENSE_APPROVED} />);
    expect(screen.getByText("Nobu Restaurant")).toBeInTheDocument();
    expect(screen.getByText(/\$287/)).toBeInTheDocument();
  });

  it("renders the status text", () => {
    render(<ExpenseRow expense={EXPENSE_APPROVED} />);
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it("shows group name", () => {
    render(<ExpenseRow expense={EXPENSE_PENDING} />);
    expect(screen.getByText(/Q1 Offsite/)).toBeInTheDocument();
  });

  it("shows third-party addedBy name", () => {
    render(<ExpenseRow expense={EXPENSE_PENDING} />);
    expect(screen.getByText(/Sarah K\./)).toBeInTheDocument();
  });

  it("receipt icon opacity is 1 when attached", () => {
    const { container } = render(<ExpenseRow expense={EXPENSE_APPROVED} />);
    const icon = container.querySelector("[title='Receipt attached']");
    expect(icon).toHaveStyle("opacity: 1");
  });

  it("receipt icon opacity is 0.2 when missing", () => {
    const { container } = render(<ExpenseRow expense={EXPENSE_PENDING} />);
    const icon = container.querySelector("[title='No receipt']");
    expect(icon).toHaveStyle("opacity: 0.2");
  });
});

// ── DonutChart ────────────────────────────────────────────────────────────────
describe("<DonutChart />", () => {
  it("renders correct number of SVG circle segments", () => {
    const { container } = render(<DonutChart data={DONUT_DATA} />);
    expect(container.querySelectorAll("circle").length).toBe(3);
  });

  it("renders all legend labels", () => {
    render(<DonutChart data={DONUT_DATA} />);
    expect(screen.getByText("Travel")).toBeInTheDocument();
    expect(screen.getByText("Software")).toBeInTheDocument();
  });

  it("shows total in centre ($1,937)", () => {
    render(<DonutChart data={DONUT_DATA} />);
    expect(screen.getByText(/\$1,937/)).toBeInTheDocument();
  });

  it("returns null for empty/zero data", () => {
    const { container } = render(
      <DonutChart data={[{ label: "X", value: 0, color: "#000" }]} />
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── ScanModal ─────────────────────────────────────────────────────────────────
describe("<ScanModal />", () => {
  const onClose = vi.fn();
  const onAdd   = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders idle state with drop zone", () => {
    render(<ScanModal onClose={onClose} onAdd={onAdd} />);
    expect(screen.getByText(/Scan Receipt/i)).toBeInTheDocument();
    expect(screen.getByText(/Drop receipt image or PDF/i)).toBeInTheDocument();
  });

  it("closes on × button click", async () => {
    render(<ScanModal onClose={onClose} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("enters manual mode on button click", async () => {
    render(<ScanModal onClose={onClose} onAdd={onAdd} />);
    await userEvent.click(screen.getByText(/Enter manually instead/i));
    expect(screen.getByLabelText(/Merchant/i)).toBeInTheDocument();
  });

  it("submits manual form correctly", async () => {
    render(<ScanModal onClose={onClose} onAdd={onAdd} />);
    await userEvent.click(screen.getByText(/Enter manually instead/i));

    await userEvent.clear(screen.getByLabelText(/Merchant/i));
    await userEvent.type(screen.getByLabelText(/Merchant/i), "Vitest Cafe");
    await userEvent.clear(screen.getByLabelText(/Amount/i));
    await userEvent.type(screen.getByLabelText(/Amount/i), "19.95");
    await userEvent.click(screen.getByText(/Save Expense/i));

    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Vitest Cafe", amount: 19.95 })
    );
  });

  it("transitions through scan stages after file drop", async () => {
    render(<ScanModal onClose={onClose} onAdd={onAdd} />);
    const dropZone = screen.getByRole("button", { name: "" });
    const file = new File(["data"], "receipt.png", { type: "image/png" });

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(await screen.findByText(/Uploading securely/i)).toBeInTheDocument();

    await act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByText(/Textract/i)).toBeInTheDocument();

    await act(() => { vi.advanceTimersByTime(2000); });
    await waitFor(() =>
      expect(screen.getByText(/Receipt Scanned/i)).toBeInTheDocument()
    );
  });
});

// ── Zustand store integration ─────────────────────────────────────────────────
describe("useExpenseStore", () => {
  it("addExpense increases the expense count", () => {
    // Dynamic import to avoid module-level side effects
    const store = useExpenseStore.getState();
    const before = store.expenses.length;

    store.addExpense(MOCK_EXPENSES[0]);

    expect(useExpenseStore.getState().expenses.length).toBe(before + 1);
  });

  it("setFilter updates the filter state", () => {

    useExpenseStore.getState().setFilter("pending");
    expect(useExpenseStore.getState().filter).toBe("pending");
  });

  it("setSearch updates the search state and filters results", () => {
    // Ensure filter is "all" (default) and search is cleared
    useExpenseStore.getState().setFilter("all");
    useExpenseStore.getState().setSearch("Starbucks");

    // Get the filtered expenses using the selector
    const state = useExpenseStore.getState();
    const filtered =selectFiltered(state);
    
    // Verify all filtered items match search params
    expect( 
      filtered.every(
        e => 
          e.merchant.toLowerCase().includes("starbucks") ||
          e.category.toLowerCase().includes("starbucks")
      )
    ).toBe(true);

    // Verify that the search state itself is updated
    expect(state.search).toBe("Starbucks");
  });
});