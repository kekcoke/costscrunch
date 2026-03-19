// ─── CostsCrunch — Theme Store (Extensible) ───────────────────────────────────
// Supports light | dark | system modes with custom style registration.
// Persists to localStorage and respects OS-level preference.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeTokens {
  // Semantic tokens
  "--color-bg": string;
  "--color-surface": string;
  "--color-surface-2": string;
  "--color-surface-3": string;
  "--color-border": string;
  "--color-border-dim": string;
  "--color-text": string;
  "--color-text-muted": string;
  "--color-text-dim": string;
  "--color-text-dimmer": string;
  // Brand accent tokens
  "--color-cyan": string;
  "--color-indigo": string;
  "--color-green": string;
  "--color-amber": string;
  "--color-red": string;
  "--color-sky": string;
}

export interface CustomTheme {
  id: string;
  name: string;
  tokens: Partial<ThemeTokens>;
}

interface ThemeState {
  mode: ThemeMode;
  customThemes: Record<string, CustomTheme>;
  activeCustomThemeId: string | null;

  // Actions
  setMode: (mode: ThemeMode) => void;
  registerCustomTheme: (theme: CustomTheme) => void;
  unregisterCustomTheme: (id: string) => void;
  activateCustomTheme: (id: string | null) => void;
  getResolvedTheme: () => "light" | "dark";
  getActiveTokens: () => Partial<ThemeTokens>;
}

// ─── Built-in Theme Tokens ─────────────────────────────────────────────────────

const DARK_TOKENS: ThemeTokens = {
  "--color-bg":           "#060e1a",
  "--color-surface":      "#0d1929",
  "--color-surface-2":    "#0a1628",
  "--color-surface-3":    "#070e1c",
  "--color-border":       "#1a2d42",
  "--color-border-dim":   "#0f1e32",
  "--color-text":         "#f1f5f9",
  "--color-text-muted":   "#94a3b8",
  "--color-text-dim":     "#475569",
  "--color-text-dimmer":  "#334155",
  "--color-cyan":         "#0ea5e9",
  "--color-indigo":       "#6366f1",
  "--color-green":        "#10b981",
  "--color-amber":        "#f59e0b",
  "--color-red":          "#ef4444",
  "--color-sky":          "#38bdf8",
};

const LIGHT_TOKENS: ThemeTokens = {
  "--color-bg":           "#f8fafc",
  "--color-surface":      "#ffffff",
  "--color-surface-2":    "#f1f5f9",
  "--color-surface-3":    "#e2e8f0",
  "--color-border":       "#cbd5e1",
  "--color-border-dim":   "#e2e8f0",
  "--color-text":         "#0f172a",
  "--color-text-muted":   "#475569",
  "--color-text-dim":     "#64748b",
  "--color-text-dimmer":  "#94a3b8",
  "--color-cyan":         "#0284c7",
  "--color-indigo":       "#4f46e5",
  "--color-green":        "#059669",
  "--color-amber":        "#d97706",
  "--color-red":          "#dc2626",
  "--color-sky":          "#0ea5e9",
};

// ─── System Preference Detection ──────────────────────────────────────────────

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// ─── Store ─────────────────────────────────────────────────────────────────────

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "dark",
      customThemes: {},
      activeCustomThemeId: null,

      setMode: (mode) => set({ mode }),

      registerCustomTheme: (theme) =>
        set((state) => ({
          customThemes: { ...state.customThemes, [theme.id]: theme },
        })),

      unregisterCustomTheme: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.customThemes;
          return {
            customThemes: rest,
            activeCustomThemeId: state.activeCustomThemeId === id ? null : state.activeCustomThemeId,
          };
        }),

      activateCustomTheme: (id) => set({ activeCustomThemeId: id }),

      getResolvedTheme: () => {
        const { mode } = get();
        if (mode === "system") return getSystemTheme();
        return mode;
      },

      getActiveTokens: () => {
        const state = get();
        const resolved = state.mode === "system" ? getSystemTheme() : state.mode;
        const baseTokens = resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS;

        // Apply custom theme overrides if active
        if (state.activeCustomThemeId && state.customThemes[state.activeCustomThemeId]) {
          return { ...baseTokens, ...state.customThemes[state.activeCustomThemeId].tokens };
        }

        return baseTokens;
      },
    }),
    {
      name: "costscrunch-theme",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        customThemes: state.customThemes,
        activeCustomThemeId: state.activeCustomThemeId,
      }),
    }
  )
);

// ─── Selectors ─────────────────────────────────────────────────────────────────

export const selectMode = (s: ThemeState) => s.mode;
export const selectCustomThemes = (s: ThemeState) => s.customThemes;
export const selectActiveCustomThemeId = (s: ThemeState) => s.activeCustomThemeId;

// ─── System Theme Listener (call once in app entry) ────────────────────────────

let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

export function initSystemThemeListener() {
  if (typeof window === "undefined" || systemThemeListener) return;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  systemThemeListener = () => {
    const state = useThemeStore.getState();
    if (state.mode === "system") {
      // Trigger re-render by setting mode to itself (forces subscribers to update)
      useThemeStore.setState({ mode: "system" });
    }
  };

  mq.addEventListener("change", systemThemeListener);
}
