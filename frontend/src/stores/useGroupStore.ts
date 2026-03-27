// ─── CostsCrunch — Group State (Zustand) ──────────────────────────────────────
import { create } from "zustand";
import { groupsApi } from "../services/api";
import type { Group } from "../models/types";

interface GroupStore {
  groups: Group[];
  loading: boolean;
  error: string | null;
  fetchGroups: () => Promise<void>;
  updateGroup: (groupId: string, data: Partial<Group>) => void;
}

export const useGroupStore = create<GroupStore>((set) => ({
  groups: [],
  loading: false,
  error: null,

  fetchGroups: async () => {
    set({ loading: true, error: null });
    try {
      const res = await groupsApi.list();
      set({ groups: res.items, loading: false });
    } catch (err: any) {
      set({ error: err.message || "Failed to fetch groups", loading: false });
    }
  },

  updateGroup: (groupId, data) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.groupId === groupId ? { ...g, ...data } : g
      ),
    }));
  },
}));
