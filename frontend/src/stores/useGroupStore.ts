// ─── CostsCrunch — Group State (Zustand) ──────────────────────────────────────
import { create } from "zustand";
import { groupsApi } from "../services/api";
import type { Group } from "../models/types";

interface GroupStore {
  groups: Group[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchGroups: () => Promise<void>;
  updateGroup: (groupId: string, data: Partial<Group>) => void;
  deleteGroup: (groupId: string) => void;
}

export const useGroupStore = create<GroupStore>((set, get) => ({
  groups: [],
  loading: false,
  error: null,
  lastFetchedAt: null,

  fetchGroups: async () => {
    const { lastFetchedAt } = get();
    if (lastFetchedAt && Date.now() - lastFetchedAt < 30_000) return;
    set({ loading: true, error: null });
    try {
      const res = await groupsApi.list();
      set({ groups: res.items, loading: false, lastFetchedAt: Date.now() });
    } catch (err: any) {
      set({ error: err.message || "Failed to fetch groups", loading: false });
    }
  },

  updateGroup: (groupId, data) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.groupId === groupId ? { ...g, ...data } : g
      ),
      lastFetchedAt: null,
    }));
  },

  deleteGroup: (groupId) => {
    set((state) => ({
      groups: state.groups.filter((g) => g.groupId !== groupId),
      lastFetchedAt: null,
    }));
  }
}));
