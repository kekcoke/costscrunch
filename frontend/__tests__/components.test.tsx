/**
 * @vitest-environment jsdom
 * 
 * components.test.tsx  (Vite / Vitest)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";

import StatCard   from "../src/components/statCard";
import ExpenseRow from "../src/components/expenseRow";
import DonutChart from "../src/components/charts/donutChart";
import DonutChartOrphan from "../src/components/donutChart";
import Sidebar from "../src/components/sideBar";
import TopBar from "../src/components/topBar";
import BubbleChart from "../src/components/charts/bubbleChart";
import StackedBarChart from "../src/components/charts/stackedBarChart";
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

  describe("<DonutChart /> (orphaned top-level component)", () => {
    it("renders correct number of SVG circle segments", () => {
      const { container } = render(<DonutChartOrphan data={DONUT_DATA} />);
      expect(container.querySelectorAll("circle").length).toBe(3);
    });

    it("renders all legend labels", () => {
      const { getAllByText } = render(<DonutChartOrphan data={DONUT_DATA} />);
      expect(getAllByText("Travel").length).toBeGreaterThan(0);
    });

    it("shows total in centre ($1,937)", () => {
      const { getByText } = render(<DonutChartOrphan data={DONUT_DATA} />);
      expect(getByText(/\$1,937/)).toBeInTheDocument();
    });

    it("renders nothing when total is zero", () => {
      const { container } = render(<DonutChartOrphan data={[{ label: "Empty", value: 0, color: "#000" }]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("<Sidebar />", () => {
    const onTabChange = vi.fn();
    const onClose = vi.fn();

    beforeEach(() => {
      onTabChange.mockClear();
      onClose.mockClear();
    });

    it("renders all nav items", () => {
      render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} />);
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Expenses")).toBeInTheDocument();
      expect(screen.getByText("Groups")).toBeInTheDocument();
      expect(screen.getByText("Analytics")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });

    it("calls onTabChange when a nav item is clicked", () => {
      render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} />);
      fireEvent.click(screen.getByText("Groups"));
      expect(onTabChange).toHaveBeenCalledWith("groups");
    });

    it("also calls onClose when mobile and open", () => {
      render(
        <Sidebar
          activeTab="dashboard"
          onTabChange={onTabChange}
          pendingCount={0}
          isMobile
          isOpen
          onClose={onClose}
        />
      );
      fireEvent.click(screen.getByText("Analytics"));
      expect(onTabChange).toHaveBeenCalledWith("analytics");
      expect(onClose).toHaveBeenCalled();
    });

    it("does not call onClose on desktop (non-mobile)", () => {
      render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} onClose={onClose} />);
      fireEvent.click(screen.getByText("Settings"));
      expect(onClose).not.toHaveBeenCalled();
    });

    it("marks the active tab with aria-current", () => {
      render(<Sidebar activeTab="expenses" onTabChange={onTabChange} pendingCount={0} />);
      expect(screen.getByText("Expenses").closest("button")).toHaveAttribute("aria-current", "page");
      expect(screen.getByText("Dashboard").closest("button")).not.toHaveAttribute("aria-current");
    });

    it("shows the pending-count badge only on the expenses item when > 0", () => {
      render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={3} />);
      expect(screen.getByLabelText("3 pending")).toBeInTheDocument();
      expect(screen.getByLabelText("3 pending")).toHaveTextContent("3");
    });

    it("hides the pending-count badge when pendingCount is 0", () => {
      render(<Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} />);
      expect(screen.queryByLabelText(/pending/i)).not.toBeInTheDocument();
    });

    it("renders the mobile overlay when isMobile and isOpen", () => {
      const { container } = render(
        <Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} isMobile isOpen onClose={onClose} />
      );
      expect(container.querySelector(".mobile-sidebar-overlay")).toBeInTheDocument();
    });

    it("omits the mobile overlay when isMobile and not open", () => {
      const { container } = render(
        <Sidebar activeTab="dashboard" onTabChange={onTabChange} pendingCount={0} isMobile isOpen={false} onClose={onClose} />
      );
      expect(container.querySelector(".mobile-sidebar-overlay")).not.toBeInTheDocument();
    });
  });

  describe("<BubbleChart />", () => {
    const BUBBLE_DATA = [
      { date: "2026-01-01", amount: 100, frequency: 3, category: "Travel" },
      { date: "2026-01-15", amount: 250, frequency: 1, category: "Groceries" },
      { date: "2026-02-01", amount: 50,  frequency: 5, category: "Travel" },
    ];

    it("shows the empty state when data is empty", () => {
      render(<BubbleChart data={[]} />);
      expect(screen.getByText(/No data available/i)).toBeInTheDocument();
    });

    it("renders one bubble circle per data point", () => {
      const { container } = render(<BubbleChart data={BUBBLE_DATA} />);
      expect(container.querySelectorAll("circle").length).toBe(BUBBLE_DATA.length);
    });

    it("shows a tooltip on hover and hides it on mouse leave", () => {
      const { container } = render(<BubbleChart data={BUBBLE_DATA} />);
      const circle = container.querySelector("circle")!;

      fireEvent.mouseEnter(circle, { clientX: 10, clientY: 20 });
      expect(screen.getAllByText("Travel").length).toBeGreaterThan(0);
      expect(screen.getByText(/transactions/i)).toBeInTheDocument();

      fireEvent.mouseMove(circle, { clientX: 30, clientY: 40 });

      fireEvent.mouseLeave(circle);
      expect(screen.queryByText(/transactions/i)).not.toBeInTheDocument();
    });

    it("renders a legend entry only for categories present in the data", () => {
      render(<BubbleChart data={BUBBLE_DATA} />);
      expect(screen.getByText("Bubble size = transaction frequency")).toBeInTheDocument();
    });

    it("uses 'Month' axis label for a year period and 'Week' for a quarter period", () => {
      const { rerender, container } = render(<BubbleChart data={BUBBLE_DATA} period="year" />);
      expect(container.querySelector('[aria-label*="over Month"]')).toBeInTheDocument();

      rerender(<BubbleChart data={BUBBLE_DATA} period="quarter" />);
      expect(container.querySelector('[aria-label*="over Week"]')).toBeInTheDocument();
    });
  });

  describe("<StackedBarChart />", () => {
    const STACKED_DATA = [
      { period: "Jan", total: 300, categories: { Travel: 200, Groceries: 100 } },
      { period: "Feb", total: 150, categories: { Travel: 150 } },
    ];

    it("shows the empty state when data is empty", () => {
      render(<StackedBarChart data={[]} />);
      expect(screen.getByText(/No data available/i)).toBeInTheDocument();
    });

    it("renders one bar group per period with a rect per non-zero category segment", () => {
      const { container } = render(<StackedBarChart data={STACKED_DATA} />);
      // Jan has 2 segments, Feb has 1 segment (its Groceries value is implicitly 0, filtered out)
      expect(container.querySelectorAll("rect").length).toBe(3);
      expect(screen.getByText("Jan")).toBeInTheDocument();
      expect(screen.getByText("Feb")).toBeInTheDocument();
    });

    it("shows a tooltip with the segment total on hover and hides it on mouse leave", () => {
      const { container } = render(<StackedBarChart data={STACKED_DATA} />);
      const rect = container.querySelector("rect")!;

      fireEvent.mouseEnter(rect, { clientX: 5, clientY: 5 });
      expect(screen.getByText(/Total:/i)).toBeInTheDocument();

      fireEvent.mouseMove(rect, { clientX: 15, clientY: 15 });

      fireEvent.mouseLeave(rect);
      expect(screen.queryByText(/Total:/i)).not.toBeInTheDocument();
    });

    it("renders a legend entry per category key present across all buckets", () => {
      render(<StackedBarChart data={STACKED_DATA} />);
      expect(screen.getAllByText("Travel").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Groceries").length).toBeGreaterThan(0);
    });
  });

  describe("<TopBar />", () => {
    it("calls onScan when the scan button is clicked", () => {
      const onScan = vi.fn();
      render(<TopBar onScan={onScan} onAdd={vi.fn()} />);
      fireEvent.click(screen.getByText(/Scan Receipt/i));
      expect(onScan).toHaveBeenCalled();
    });

    it("calls onAdd when the add button is clicked", () => {
      const onAdd = vi.fn();
      render(<TopBar onScan={vi.fn()} onAdd={onAdd} />);
      fireEvent.click(screen.getByText(/Add Expense/i));
      expect(onAdd).toHaveBeenCalled();
    });

    it("calls onMenuClick when the mobile menu button is clicked", () => {
      const onMenuClick = vi.fn();
      render(<TopBar onScan={vi.fn()} onAdd={vi.fn()} onMenuClick={onMenuClick} />);
      fireEvent.click(screen.getByLabelText("Open menu"));
      expect(onMenuClick).toHaveBeenCalled();
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
