// ─── CostsCrunch — Utility Helpers ─────────────────────────────────────────────

/**
 * Format a number as USD currency string.
 * @param {number} n
 * @returns {string}  e.g. "$1,204.33"
 */
export const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/**
 * Format an ISO date string as "Feb 28".
 * @param {string} d  ISO date string e.g. "2026-02-28"
 * @returns {string}
 */
export const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * Generate a lightweight unique ID for optimistic client-side records.
 * Replace with ulid/uuid when wiring a real backend.
 * @returns {string}
 */
export const tempId = () => `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * Clamp a value between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);