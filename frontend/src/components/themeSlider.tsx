// ─── CostsCrunch — Theme Slider Component ─────────────────────────────────────
// 3-position toggle: Light (☀️) | System (🖥️) | Dark (🌙)
// Slides left/center/right with icon indicator.

import { useThemeStore, selectMode, type ThemeMode } from "../stores/useThemeStore";

const THEME_OPTIONS: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: "light", icon: "☀️", label: "Light theme" },
  { mode: "system", icon: "🖥️", label: "System theme" },
  { mode: "dark", icon: "🌙", label: "Dark theme" },
];

export default function ThemeSlider() {
  const mode = useThemeStore(selectMode);
  const setMode = useThemeStore((s) => s.setMode);

  const currentIndex = THEME_OPTIONS.findIndex((opt) => opt.mode === mode);
  const activeIndex = currentIndex >= 0 ? currentIndex : 2; // Default to dark

  return (
    <div
      role="radiogroup"
      aria-label="Theme selection"
      style={{
        display: "flex",
        alignItems: "center",
        background: "var(--color-surface-2)",
        borderRadius: "8px",
        padding: "3px",
        position: "relative",
        height: "32px",
      }}
    >
      {/* Sliding indicator */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: "36px",
          height: "26px",
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "6px",
          left: `${3 + activeIndex * 38}px`,
          transition: "left 0.2s ease",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />

      {/* Option buttons */}
      {THEME_OPTIONS.map((opt, idx) => (
        <button
          key={opt.mode}
          role="radio"
          aria-checked={mode === opt.mode}
          aria-label={opt.label}
          title={opt.label}
          onClick={() => setMode(opt.mode)}
          style={{
            width: "36px",
            height: "26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: "14px",
            position: "relative",
            zIndex: 1,
            opacity: mode === opt.mode ? 1 : 0.5,
            transition: "opacity 0.15s",
          }}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
