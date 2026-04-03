import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import GroupDetail from "../src/components/groups/groupDetail";
import { groupsApi } from "../src/services/api";

// Mock the API and LoadingSpinner
vi.mock("../src/services/api", () => ({
  groupsApi: {
    get: vi.fn(),
    update: vi.fn(),
    deleteMember: vi.fn(),
    addMember: vi.fn(),
    getBalances: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../src/components/spinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}));

// Mock Modal since it might use portals
vi.mock("../src/components/modal", () => ({
  default: ({ children, isOpen, title }: any) => 
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

const MOCK_GROUP = {
  groupId: "g1",
  name: "Adventure Squad",
  description: "Planning our trek",
  color: "#6366f1",
  members: [
    { userId: "u1", name: "Alice", role: "owner", email: "alice@test.com" },
    { userId: "u2", name: "Bob", role: "member", email: "bob@test.com" }
  ],
  memberCount: 2,
  totalSpend: 100,
  monthSpend: 50,
  expenseCount: 5,
};

describe("GroupDetail Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (groupsApi.get as any).mockResolvedValue(MOCK_GROUP);
  });

  it("switches to edit mode when 'Update Group' is clicked", async () => {
    render(<GroupDetail groupId="g1" onBack={() => {}} />);
    
    // Wait for load
    await waitFor(() => expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument());
    
    const updateBtn = screen.getByText(/Update Group/i);
    fireEvent.click(updateBtn);
    
    expect(screen.getByText(/Update Group Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Back to Group Detail/i)).toBeInTheDocument();
    
    // Check if form is populated
    const nameInput = screen.getByDisplayValue("Adventure Squad");
    expect(nameInput).toBeInTheDocument();
  });

  it("submits the update form and shows success message", async () => {
    (groupsApi.update as any).mockResolvedValue({ ...MOCK_GROUP, name: "New Name" });
    
    render(<GroupDetail groupId="g1" onBack={() => {}} />);
    await waitFor(() => screen.getByText(/Update Group/i));
    
    fireEvent.click(screen.getByText(/Update Group/i));
    
    const nameInput = screen.getByDisplayValue("Adventure Squad");
    fireEvent.change(nameInput, { target: { value: "New Name" } });
    
    const submitBtn = screen.getByText(/Submit Changes/i);
    fireEvent.click(submitBtn);
    
    await waitFor(() => expect(screen.getByText(/Group updated successfully!/i)).toBeInTheDocument());
    expect(groupsApi.update).toHaveBeenCalledWith("g1", expect.objectContaining({
      name: "New Name"
    }));
  });

  it("handles member removal by passing correct userId", async () => {
    render(<GroupDetail groupId="g1" onBack={() => {}} />);
    
    // Wait for Bob's remove button to appear
    const removeBtns = await screen.findAllByText(/Remove/i);
    
    // Click the first one found (Bob's, since Alice is owner and now excluded)
    fireEvent.click(removeBtns[0]);
    
    // Check if delete modal opened (mocked as simple div)
    expect(screen.getByText(/Are you sure you want to remove/i)).toBeInTheDocument();
    
    const confirmBtn = screen.getByText(/Confirm Remove/i);
    fireEvent.click(confirmBtn);
    
    await waitFor(() => expect(groupsApi.deleteMember).toHaveBeenCalledWith("g1", "u2"));
  });
});
