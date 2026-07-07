import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useGroupStore } from "../../src/stores/useGroupStore";
import { groupsApi } from "../../src/services/api";
import type { Group } from "../../src/models/types";

vi.mock("../../src/services/api", () => ({
  groupsApi: {
    list: vi.fn(),
  },
}));

function mockGroup(overrides: Partial<Group> = {}): Group {
  return {
    groupId: "g1",
    name: "Q1 Offsite",
    type: "team",
    ownerId: "u1",
    color: "#6366f1",
    members: [],
    memberCount: 3,
    totalSpend: 1000,
    monthSpend: 500,
    expenseCount: 5,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    total: 1000,
    myShare: 250,
    ...overrides,
  } as Group;
}

describe("useGroupStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGroupStore.setState({
      groups: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchGroups success: sets groups, clears loading, and records lastFetchedAt", async () => {
    vi.mocked(groupsApi.list).mockResolvedValue({ items: [mockGroup()] });

    await useGroupStore.getState().fetchGroups();

    const state = useGroupStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.lastFetchedAt).not.toBeNull();
  });

  it("skips re-fetching within the 30s throttle window", async () => {
    vi.mocked(groupsApi.list).mockResolvedValue({ items: [mockGroup()] });
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);

    useGroupStore.setState({ lastFetchedAt: now - 10_000 }); // 10s ago, within 30s window

    await useGroupStore.getState().fetchGroups();

    expect(groupsApi.list).not.toHaveBeenCalled();
  });

  it("re-fetches once the 30s throttle window has passed", async () => {
    vi.mocked(groupsApi.list).mockResolvedValue({ items: [mockGroup()] });
    const now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);

    useGroupStore.setState({ lastFetchedAt: now - 31_000 }); // 31s ago, past the window

    await useGroupStore.getState().fetchGroups();

    expect(groupsApi.list).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sets an error and clears loading when the fetch rejects", async () => {
    vi.mocked(groupsApi.list).mockRejectedValue(new Error("network down"));

    await useGroupStore.getState().fetchGroups();

    const state = useGroupStore.getState();
    expect(state.error).toBe("network down");
    expect(state.loading).toBe(false);
  });

  it("falls back to a generic error message when the rejection has no message", async () => {
    vi.mocked(groupsApi.list).mockRejectedValue({});

    await useGroupStore.getState().fetchGroups();

    expect(useGroupStore.getState().error).toBe("Failed to fetch groups");
  });

  it("updateGroup merges a patch into the matching group and resets lastFetchedAt", () => {
    useGroupStore.setState({
      groups: [mockGroup({ groupId: "g1", name: "Old Name" }), mockGroup({ groupId: "g2", name: "Other" })],
      lastFetchedAt: 123,
    });

    useGroupStore.getState().updateGroup("g1", { name: "New Name" });

    const state = useGroupStore.getState();
    expect(state.groups.find((g) => g.groupId === "g1")?.name).toBe("New Name");
    expect(state.groups.find((g) => g.groupId === "g2")?.name).toBe("Other");
    expect(state.lastFetchedAt).toBeNull();
  });

  it("deleteGroup removes the matching group and resets lastFetchedAt", () => {
    useGroupStore.setState({
      groups: [mockGroup({ groupId: "g1" }), mockGroup({ groupId: "g2" })],
      lastFetchedAt: 123,
    });

    useGroupStore.getState().deleteGroup("g1");

    const state = useGroupStore.getState();
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].groupId).toBe("g2");
    expect(state.lastFetchedAt).toBeNull();
  });
});
