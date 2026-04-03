/**
 * @vitest-environment jsdom
 * 
 * components.test.tsx  (Vite / Vitest)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

import StatCard   from "../src/components/statCard";
import ExpenseRow from "../src/components/expenseRow";
import DonutChart from "../src/components/charts/donutChart";
import ScanModal  from "../src/components/scanModal";
import GroupDetail from "../src/components/groups/groupDetail";
import { SEED_EXPENSES_MOCK } from "../src/mocks/expenses";

const EXPENSE_APPROVED = SEED_EXPENSES_MOCK[1];
const EXPENSE_PENDING = SEED_EXPENSES_MOCK[2];
const DONUT_DATA = [
  { label: "Travel",   value: 450,  color: "#6366f1" },
  { label: "Meals",    value: 287,  color: "#f59e0b" },
  { label: "Software", value: 1200, color: "#8b5cf6" },
];

describe("Component Suite", () => {
  beforeEach(() => {
    cleanup();
  });

  describe("<StatCard />", () => {
    it("renders label and value", () => {
      const { getByText } = render(<StatCard label="Month Total" value="$2,041.70" />);
      expect(getByText("Month Total")).toBeInTheDocument();
      expect(getByText("$2,041.70")).toBeInTheDocument();
    });

    it("renders optional sub-text", () => {
      const { getByText } = render(<StatCard label="Pending" value="3" sub="$287.50 to approve" />);
      expect(getByText("$287.50 to approve")).toBeInTheDocument();
    });

    it("omits sub element when not provided", () => {
      const { container } = render(<StatCard label="Groups" value="3" />);
      const sub = container.querySelector('div[style*="color: rgb(100, 116, 139)"]');
      expect(sub).toBeNull();
    });
  });

  describe("<ExpenseRow />", () => {
    it("renders merchant and amount", () => {
      const { getByText } = render(<ExpenseRow expense={EXPENSE_APPROVED} />);
      expect(getByText("Delta Airlines")).toBeInTheDocument();
      expect(getByText(/\$428/)).toBeInTheDocument();
    });

    it("renders the status text", async () => {
      const { container } = render(<ExpenseRow expense={EXPENSE_APPROVED} />);
      const status = await vi.waitFor(() => {
        const el = container.querySelector('div[style*="text-transform: uppercase"]');
        if (!el || !/approved/i.test(el.textContent || "")) throw new Error("not found");
        return el;
      });
      expect(status).toBeInTheDocument();
    });

    it("shows third-party addedBy name", () => {
      const { getByText } = render(<ExpenseRow expense={EXPENSE_PENDING} />);
      expect(getByText(/Sarah K\./)).toBeInTheDocument();
    });

    it("receipt icon opacity is 1 when attached", () => {
      const { container } = render(<ExpenseRow expense={EXPENSE_APPROVED} />);
      const icon = container.querySelector("[title='Receipt attached']");
      expect(icon).toHaveStyle("opacity: 1");
    });
  });

  describe("<DonutChart />", () => {
    it("renders correct number of SVG circle segments", () => {
      const { container } = render(<DonutChart data={DONUT_DATA} />);
      expect(container.querySelectorAll("circle").length).toBe(3);
    });

    it("renders all legend labels", () => {
      const { getAllByText } = render(<DonutChart data={DONUT_DATA} />);
      expect(getAllByText("Travel").length).toBeGreaterThan(0);
    });

    it("shows total in centre ($1,937)", () => {
      const { getByText } = render(<DonutChart data={DONUT_DATA} />);
      expect(getByText(/\$1,937/)).toBeInTheDocument();
    });
  });

  describe("<ScanModal />", () => {
    const onClose = vi.fn();
    const onAdd   = vi.fn();

    it("renders idle state with drop zone", () => {
      const { getByText } = render(<ScanModal onClose={onClose} onAdd={onAdd} />);
      expect(getByText(/Scan Receipt/i)).toBeInTheDocument();
      expect(getByText(/Drop receipt image or PDF/i)).toBeInTheDocument();
    });

    it("closes on × button click", async () => {
      const { getByRole } = render(<ScanModal onClose={onClose} onAdd={onAdd} />);
      await userEvent.click(getByRole("button", { name: /close/i }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("enters manual mode on button click", async () => {
      const { getByText, getByLabelText } = render(<ScanModal onClose={onClose} onAdd={onAdd} />);
      await userEvent.click(getByText(/Enter manually instead/i));
      expect(getByLabelText(/Merchant/i)).toBeInTheDocument();
    });
  });

  describe("<GroupDetail />", () => {
    const onBack = vi.fn();

    beforeEach(() => {
      vi.mock("../src/services/api", () => ({
        groupsApi: {
          get: vi.fn(() => Promise.resolve({ 
            id: "g1", 
            name: "Housemates", 
            memberCount: 3, 
            color: "#6366f1",
            members: [
              { userId: "u1", name: "Alex Rivera", role: "owner" },
              { userId: "u2", name: "Jane Doe", role: "member" }
            ]
          })),
          addMember: vi.fn(() => Promise.resolve({ added: true })),
          deleteMember: vi.fn(() => Promise.resolve({ success: true })),
          update: vi.fn(() => Promise.resolve({})),
          getBalances: vi.fn(() => Promise.resolve([])),
        }
      }));
    });

    it("renders group details and members", async () => {
      const { findByText, getAllByText } = render(<GroupDetail groupId="g1" onBack={onBack} />);
      expect(await findByText("Housemates")).toBeInTheDocument();
      expect(getAllByText("Alex Rivera").length).toBeGreaterThan(0);
    });

    it("opens add member modal and submits successfully", async () => {
      const { findAllByText, findByText, getByRole, getByPlaceholderText } = render(<GroupDetail groupId="g1" onBack={onBack} />);
      const addButtons = await findAllByText(/\+ Add Member/i);
      await userEvent.click(addButtons[0]);

      expect(await findByText("Add Group Member")).toBeInTheDocument();
      await userEvent.type(getByPlaceholderText(/john@example.com/i), "test@example.com");
      
      const submitButton = getByRole("button", { name: /^Add Member$/ });
      await userEvent.click(submitButton);

      expect(await findByText(/Member added successfully/i)).toBeInTheDocument();
    });
  });
});
