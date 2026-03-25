import { createHash } from "crypto";

// ─── Generic Entity Hash ────────────────────────────────────────────────────
// Computes a deterministic SHA-256 from one or more pre-normalized strings.
// Each entity type provides its own normalizer that returns string parts;
// this function is agnostic to the domain.
//
// Future entities (e.g. invoices, mileage logs) call:
//   computeEntityHash(...normalizeInvoiceFields(...))
//   computeEntityHash(...normalizeMileageFields(...))

/**
 * Deterministic SHA-256 hex digest from concatenated parts.
 * @param parts - Pre-normalized string values joined with "|" separator
 * @returns 64-char lowercase hex string
 */
export function computeEntityHash(...parts: string[]): string {
  const input = parts.join("|");
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

// ─── Receipt-Specific Normalizer ────────────────────────────────────────────
// References: Expense.merchant (string), Expense.date (YYYY-MM-DD),
//             Expense.amount (number) from backend/src/shared/models/types.ts

/**
 * Normalizes receipt fields for duplicate detection hashing.
 * - merchant: lowercase, trimmed (removes case/whitespace differences)
 * - date: first 10 chars only (YYYY-MM-DD, strips time if present)
 * - amount: rounded to 2 decimal places (removes floating-point noise)
 */
export function normalizeReceiptFields(
  merchant: string,
  date: string,
  amount: number,
): string[] {
  return [
    merchant.toLowerCase().trim(),
    date.slice(0, 10),
    Math.round(amount * 100) / 100,   // avoid toFixed string-conversion edge cases
  ].map(String);
}

/** Convenience: compute receipt duplicate hash from raw Textract fields. */
export function computeReceiptHash(
  merchant: string,
  date: string,
  amount: number,
): string {
  return computeEntityHash(...normalizeReceiptFields(merchant, date, amount));
}
