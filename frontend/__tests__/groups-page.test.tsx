import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GroupsPage } from "../src/pages/groups";
import { useGroupStore } from "../src/stores/useGroupStore";
import { useExpenseStore } from "../src/stores/useExpenseStore";
import { groupsApi } from "../src/services/api";

// Mock the stores
vi.mock("../src/stores/useGroupStore", () => ({
  useGroupStore: vi.fn(),
}));

vi.mock("../src/stores/useExpenseStore", () => ({
  useExpenseStore: vi.fn(),
  selectExpenses: vi.fn(),
}));

// Mock groupsApi
vi.mock("../src/services/api", () => ({
  groupsApi: {
    create: vi.fn(),
    settle: vi.fn(),
  },
}));

const MOCK_GROUPS = [
  { groupId: "g1", name: "Zebra Group", type: "household", totalSpend: 500, monthSpend: 100, color: "#6366f1", members: 2, myShare: 250, total: 500 },
  { groupId: "g2", name: "Alpha Group", type: "business", totalSpend: 1000, monthSpend: 50, color: "#10b981", members: 5, myShare: 200, total: 1000 },
];

describe("GroupsPage - Filtering & Sorting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useGroupStore as any).mockReturnValue({
      groups: MOCK_GROUPS,
      loading: false,
      fetchGroups: vi.fn(),
    });
    (useExpenseStore as any).mockReturnValue([]);
  });

  it("filters groups by name correctly", () => {
    render(<GroupsPage />);
    
    const searchInput = screen.getByPlaceholderText(/Search groups by name/i);
    fireEvent.change(searchInput, { target: { value: "Alpha" } });
    
    expect(screen.getByText("Alpha Group")).toBeInTheDocument();
    expect(screen.queryByText("Zebra Group")).not.toBeInTheDocument();
  });

  it("sorts groups by name descending when toggled", () => {
    render(<GroupsPage />);
    
    // Default is name ASC: Alpha should come before Zebra
    let groupNames = screen.getAllByText(/Group$/i).map(el => el.textContent);
    expect(groupNames[0]).toBe("Alpha Group"); 
    
    const sortBtn = screen.getByTitle(/Ascending/i);
    fireEvent.click(sortBtn); // Switch to DESC
    
    groupNames = screen.getAllByText(/Group$/i).map(el => el.textContent);
    expect(groupNames[0]).toBe("Zebra Group"); 
  });

  it("shows empty state when no groups match search", () => {
    render(<GroupsPage />);
    
    const searchInput = screen.getByPlaceholderText(/Search groups by name/i);
    fireEvent.change(searchInput, { target: { value: "NonExistent" } });
    
    expect(screen.getByText(/No groups found matching/i)).toBeInTheDocument();
  });
});

describe("GroupsPage - Settle Balance Button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useGroupStore as any).mockReturnValue({
      groups: MOCK_GROUPS,
      loading: false,
      fetchGroups: vi.fn(),
    });
    (useExpenseStore as any).mockReturnValue([]);
    vi.mocked(groupsApi.settle).mockResolvedValue({ message: "Settled 2 expenses" });
  });

  it("renders settle button for each group card", () => {
    render(<GroupsPage />);
    const settleButtons = screen.getAllByText("Settle Balance");
    expect(settleButtons).toHaveLength(2);
  });

  it("calls groupsApi.settle with correct groupId on button click", () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    
    render(<GroupsPage />);
    
    // First settle button (Alpha Group comes first alphabetically)
    const settleButton = screen.getAllByText("Settle Balance")[0];
    fireEvent.click(settleButton);
    
    expect(global.confirm).toHaveBeenCalled();
    expect(groupsApi.settle).toHaveBeenCalledWith("g2"); // Alpha Group's ID
  });

  it("does not call settle when user cancels confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    
    render(<GroupsPage />);
    
    const settleButton = screen.getAllByText("Settle Balance")[0];
    fireEvent.click(settleButton);
    
    expect(groupsApi.settle).not.toHaveBeenCalled();
  });
});
