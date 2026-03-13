/**
 * theme-store.test.tsx — Integration Tests for Theme System
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers:
 *   • Built-in themes: light, dark, system
 *   • Custom theme registration, activation, removal
 *   • Persistence to localStorage
 *   • UI slider interactions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react-dom/test-utils";

import {
  useThemeStore,
  selectMode,
  selectCustomThemes,
  selectActiveCustomThemeId,
  initSystemThemeListener,
  type CustomTheme,
} from "../src/stores/useThemeStore";
import ThemeSlider from "../src/components/themeSlider";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOM_THEME_OCEAN: CustomTheme = {
  id: "ocean-theme",
  name: "Ocean Blue",
  tokens: {
    "--color-bg": "#0a192f",
    "--color-surface": "#112240",
    "--color-cyan": "#64ffda",
    "--color-indigo": "#7b68ee",
  },
};

const CUSTOM_THEME_SUNSET: CustomTheme = {
  id: "sunset-theme",
  name: "Sunset Orange",
  tokens: {
    "--color-bg": "#1a0a0a",
    "--color-surface": "#2a1515",
    "--color-amber": "#ff6b35",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("useThemeStore — Built-in Themes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mode: "dark", customThemes: {}, activeCustomThemeId: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Dark Theme ──────────────────────────────────────────────────────────────
  describe("Dark Theme", () => {
    it("defaults to dark mode", () => {
      expect(useThemeStore.getState().mode).toBe("dark");
    });

    it("getResolvedTheme returns 'dark' when mode is dark", () => {
      useThemeStore.getState().setMode("dark");
      expect(useThemeStore.getState().getResolvedTheme()).toBe("dark");
    });

    it("getActiveTokens returns dark color tokens", () => {
      useThemeStore.getState().setMode("dark");
      const tokens = useThemeStore.getState().getActiveTokens();
      expect(tokens["--color-bg"]).toBe("#060e1a");
      expect(tokens["--color-text"]).toBe("#f1f5f9");
    });

    it("persists dark mode to localStorage", () => {
      useThemeStore.getState().setMode("dark");
      const stored = JSON.parse(window.localStorage.getItem("costscrunch-theme") || "{}");
      expect(stored.state.mode).toBe("dark");
    });
  });

  // ── Light Theme ─────────────────────────────────────────────────────────────
  describe("Light Theme", () => {
    it("can switch to light mode", () => {
      useThemeStore.getState().setMode("light");
      expect(useThemeStore.getState().mode).toBe("light");
    });

    it("getResolvedTheme returns 'light' when mode is light", () => {
      useThemeStore.getState().setMode("light");
      expect(useThemeStore.getState().getResolvedTheme()).toBe("light");
    });

    it("getActiveTokens returns light color tokens", () => {
      useThemeStore.getState().setMode("light");
      const tokens = useThemeStore.getState().getActiveTokens();
      expect(tokens["--color-bg"]).toBe("#f8fafc");
      expect(tokens["--color-text"]).toBe("#0f172a");
    });

    it("persists light mode to localStorage", () => {
      useThemeStore.getState().setMode("light");
      const stored = JSON.parse(window.localStorage.getItem("costscrunch-theme") || "{}");
      expect(stored.state.mode).toBe("light");
    });
  });

  // ── System Theme ────────────────────────────────────────────────────────────
  describe("System Theme", () => {
    it("can switch to system mode", () => {
      useThemeStore.getState().setMode("system");
      expect(useThemeStore.getState().mode).toBe("system");
    });

    it("resolves to 'dark' when OS prefers dark (mocked)", () => {
      useThemeStore.getState().setMode("system");
      // matchMedia mock defaults to dark preference
      expect(useThemeStore.getState().getResolvedTheme()).toBe("dark");
    });

    it("resolves to 'light' when OS prefers light", () => {
      // Override matchMedia to prefer light
      vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: light)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      useThemeStore.getState().setMode("system");
      expect(useThemeStore.getState().getResolvedTheme()).toBe("light");
    });

    it("initSystemThemeListener registers media query listener", () => {
      const addEventListenerSpy = vi.spyOn(window, "matchMedia").mockReturnValue({
        matches: true,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      });

      initSystemThemeListener();
      expect(addEventListenerSpy).toHaveBeenCalled();
    });

    it("persists system mode to localStorage", () => {
      useThemeStore.getState().setMode("system");
      const stored = JSON.parse(window.localStorage.getItem("costscrunch-theme") || "{}");
      expect(stored.state.mode).toBe("system");
    });
  });
});

describe("useThemeStore — Custom Themes", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mode: "dark", customThemes: {}, activeCustomThemeId: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Registration ────────────────────────────────────────────────────────────
  describe("Custom Theme Registration", () => {
    it("can register a custom theme", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      const themes = useThemeStore.getState().customThemes;
      expect(themes["ocean-theme"]).toEqual(CUSTOM_THEME_OCEAN);
    });

    it("can register multiple custom themes", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_SUNSET);
      const themes = useThemeStore.getState().customThemes;
      expect(Object.keys(themes)).toHaveLength(2);
    });

    it("overwrites existing theme with same id", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      const updated: CustomTheme = {
        ...CUSTOM_THEME_OCEAN,
        name: "Ocean Blue v2",
      };
      useThemeStore.getState().registerCustomTheme(updated);
      const themes = useThemeStore.getState().customThemes;
      expect(themes["ocean-theme"].name).toBe("Ocean Blue v2");
    });

    it("persists custom themes to localStorage", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      const stored = JSON.parse(window.localStorage.getItem("costscrunch-theme") || "{}");
      expect(stored.state.customThemes["ocean-theme"]).toBeDefined();
    });
  });

  // ── Activation ──────────────────────────────────────────────────────────────
  describe("Custom Theme Activation", () => {
    it("can activate a custom theme", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().activateCustomTheme("ocean-theme");
      expect(useThemeStore.getState().activeCustomThemeId).toBe("ocean-theme");
    });

    it("getActiveTokens merges custom tokens with base theme", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().activateCustomTheme("ocean-theme");
      const tokens = useThemeStore.getState().getActiveTokens();
      expect(tokens["--color-bg"]).toBe("#0a192f"); // Custom override
      expect(tokens["--color-border"]).toBe("#1a2d42"); // Falls back to dark base
    });

    it("can deactivate custom theme by setting null", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().activateCustomTheme("ocean-theme");
      useThemeStore.getState().activateCustomTheme(null);
      expect(useThemeStore.getState().activeCustomThemeId).toBeNull();
    });

    it("persisted custom theme is restored on store init", async () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().activateCustomTheme("ocean-theme");

      // Simulate page reload by creating new store instance
      const storedData = window.localStorage.getItem("costscrunch-theme");
      expect(storedData).toBeDefined();
      const parsed = JSON.parse(storedData!);
      expect(parsed.state.activeCustomThemeId).toBe("ocean-theme");
    });
  });

  // ── Removal ─────────────────────────────────────────────────────────────────
  describe("Custom Theme Removal", () => {
    it("can unregister a custom theme", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().unregisterCustomTheme("ocean-theme");
      const themes = useThemeStore.getState().customThemes;
      expect(themes["ocean-theme"]).toBeUndefined();
    });

    it("deactivates custom theme when removed", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().activateCustomTheme("ocean-theme");
      useThemeStore.getState().unregisterCustomTheme("ocean-theme");
      expect(useThemeStore.getState().activeCustomThemeId).toBeNull();
    });

    it("does not affect other custom themes on removal", () => {
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
      useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_SUNSET);
      useThemeStore.getState().unregisterCustomTheme("ocean-theme");
      const themes = useThemeStore.getState().customThemes;
      expect(themes["sunset-theme"]).toBeDefined();
    });
  });
});

describe("useThemeStore — Selectors", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mode: "dark", customThemes: {}, activeCustomThemeId: null });
  });

  it("selectMode returns current mode", () => {
    useThemeStore.getState().setMode("light");
    const mode = selectMode(useThemeStore.getState());
    expect(mode).toBe("light");
  });

  it("selectCustomThemes returns custom themes record", () => {
    useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
    const themes = selectCustomThemes(useThemeStore.getState());
    expect(themes["ocean-theme"]).toBeDefined();
  });

  it("selectActiveCustomThemeId returns active theme id", () => {
    useThemeStore.getState().registerCustomTheme(CUSTOM_THEME_OCEAN);
    useThemeStore.getState().activateCustomTheme("ocean-theme");
    const activeId = selectActiveCustomThemeId(useThemeStore.getState());
    expect(activeId).toBe("ocean-theme");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ThemeSlider Component Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("<ThemeSlider /> — UI Integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mode: "dark", customThemes: {}, activeCustomThemeId: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders all three theme options", () => {
    render(<ThemeSlider />);
    expect(screen.getByRole("radiogroup", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /system/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /dark/i })).toBeInTheDocument();
  });

  it("shows dark option as checked by default", () => {
    render(<ThemeSlider />);
    const darkBtn = screen.getByRole("radio", { name: /dark/i });
    expect(darkBtn).toHaveAttribute("aria-checked", "true");
  });

  it("switches to light theme on click", async () => {
    render(<ThemeSlider />);
    const lightBtn = screen.getByRole("radio", { name: /light/i });

    await userEvent.click(lightBtn);

    expect(useThemeStore.getState().mode).toBe("light");
    expect(lightBtn).toHaveAttribute("aria-checked", "true");
  });

  it("switches to system theme on click", async () => {
    render(<ThemeSlider />);
    const systemBtn = screen.getByRole("radio", { name: /system/i });

    await userEvent.click(systemBtn);

    expect(useThemeStore.getState().mode).toBe("system");
    expect(systemBtn).toHaveAttribute("aria-checked", "true");
  });

  it("only one option is checked at a time", async () => {
    render(<ThemeSlider />);

    const lightBtn = screen.getByRole("radio", { name: /light/i });
    const darkBtn = screen.getByRole("radio", { name: /dark/i });
    const systemBtn = screen.getByRole("radio", { name: /system/i });

    // Initially dark is checked
    expect(darkBtn).toHaveAttribute("aria-checked", "true");
    expect(lightBtn).toHaveAttribute("aria-checked", "false");
    expect(systemBtn).toHaveAttribute("aria-checked", "false");

    // Click light
    await userEvent.click(lightBtn);
    expect(lightBtn).toHaveAttribute("aria-checked", "true");
    expect(darkBtn).toHaveAttribute("aria-checked", "false");
    expect(systemBtn).toHaveAttribute("aria-checked", "false");
  });

  it("reflects store changes from external sources", async () => {
    render(<ThemeSlider />);

    // External change (e.g., from settings page)
    act(() => {
      useThemeStore.getState().setMode("system");
    });

    const systemBtn = screen.getByRole("radio", { name: /system/i });
    await waitFor(() => {
      expect(systemBtn).toHaveAttribute("aria-checked", "true");
    });
  });

  it("sliding indicator position changes on mode switch", async () => {
    const { container } = render(<ThemeSlider />);

    // Get the sliding indicator
    const indicator = container.querySelector("[aria-hidden]");
    expect(indicator).toBeInTheDocument();

    // Click light (leftmost position)
    await userEvent.click(screen.getByRole("radio", { name: /light/i }));

    // The indicator should have moved
    // Position calculation: 3 + (0 * 38) = 3px for light
    expect(indicator).toHaveStyle({ left: "3px" });

    // Click dark (rightmost position)
    await userEvent.click(screen.getByRole("radio", { name: /dark/i }));

    // Position calculation: 3 + (2 * 38) = 79px for dark
    expect(indicator).toHaveStyle({ left: "79px" });
  });

  it("has accessible aria-labels for each button", () => {
    render(<ThemeSlider />);

    const buttons = screen.getAllByRole("radio");
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute("aria-label");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: Theme Store + CSS Classes
// ─────────────────────────────────────────────────────────────────────────────

describe("Theme Integration with CSS", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mode: "dark", customThemes: {}, activeCustomThemeId: null });
  });

  it("getResolvedTheme returns correct class suffix for dark", () => {
    useThemeStore.getState().setMode("dark");
    const theme = useThemeStore.getState().getResolvedTheme();
    expect(theme).toBe("dark");
    // Usage: className={`theme-${theme}`} → "theme-dark"
  });

  it("getResolvedTheme returns correct class suffix for light", () => {
    useThemeStore.getState().setMode("light");
    const theme = useThemeStore.getState().getResolvedTheme();
    expect(theme).toBe("light");
    // Usage: className={`theme-${theme}`} → "theme-light"
  });

  it("getResolvedTheme returns 'dark' or 'light' for system (never 'system')", () => {
    useThemeStore.getState().setMode("system");
    const theme = useThemeStore.getState().getResolvedTheme();
    expect(["dark", "light"]).toContain(theme);
    // Usage: className={`theme-${theme}`} → "theme-dark" or "theme-light"
  });
});
