// ─── CostsCrunch — Utility Helpers ─────────────────────────────────────────────

/**
 * Format a number as USD currency string.
 * @param {number} value
 * @returns {string}  e.g. "$1,204.33"
 */
export const fmt = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);

/**
 * Format an ISO date string as "Feb 28".
 * @param {string} iso  ISO date string e.g. "2026-02-28"
 * @returns {string}
 */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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

export function createKeyValidator<T extends object>(obj: T, objectName: string = 'object') {
  return function(key: unknown): key is keyof T {
    if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'symbol') {
      console.warn(`Key must be a string, number, or symbol, got ${typeof key}`);
      return false;
    }
    const isValid = key in obj;
    if (!isValid) {
      console.warn(`Key "${String(key)}" not found in ${objectName}`);
    }
    return isValid;
  };
}