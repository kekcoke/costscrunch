// ─── Fuzzy Matching for Duplicate Detection ─────────────────────────────────
// Used when an exact SHA-256 hash match is found but the raw fields differ
// slightly (e.g. "STARBUCKS" vs "STARBUCKS COFFEE #1234").
//
// Levenshtein distance: minimum single-character edits to transform a → b.
// Amount tolerance: ±$0.50 to catch rounding differences across receipts.

export interface FuzzyMatchResult {
  isDuplicate: boolean;
  similarity: "exact" | "fuzzy" | "none";
  merchantDistance: number;
  amountDifference: number;
}

/** Default tolerances for receipt duplicate detection. */
const DEFAULT_MAX_MERCHANT_DISTANCE = 10;  // Levenshtein edits
const DEFAULT_AMOUNT_TOLERANCE = 0.50;     // ±$0.50

/**
 * Compute Levenshtein distance between two strings.
 * O(n*m) time, O(min(n,m)) space using single-row optimization.
 */
export function levenshtein(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const lenShort = short.length;
  const lenLong = long.length;

  if (lenShort === 0) return lenLong;

  // Single-row DP: previous row values reused in-place
  let prev = Array.from({ length: lenShort + 1 }, (_, i) => i);

  for (let i = 1; i <= lenLong; i++) {
    const curr = [i];
    for (let j = 1; j <= lenShort; j++) {
      const cost = short[j - 1] === long[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,       // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    prev = curr;
  }

  return prev[lenShort];
}

/**
 * Compare two receipts for fuzzy duplicate similarity.
 *
 * @param merchantA - Existing expense merchant name
 * @param merchantB - Incoming receipt merchant name
 * @param amountA   - Existing expense amount
 * @param amountB   - Incoming receipt amount
 * @param opts      - Override default tolerances
 */
export function fuzzyMatchReceipt(
  merchantA: string,
  merchantB: string,
  amountA: number,
  amountB: number,
  opts?: {
    maxMerchantDistance?: number;
    amountTolerance?: number;
  },
): FuzzyMatchResult {
  const maxDist = opts?.maxMerchantDistance ?? DEFAULT_MAX_MERCHANT_DISTANCE;
  const tolerance = opts?.amountTolerance ?? DEFAULT_AMOUNT_TOLERANCE;

  const merchantDistance = levenshtein(
    merchantA.toLowerCase().trim(),
    merchantB.toLowerCase().trim(),
  );
  const amountDifference = Math.abs(amountA - amountB);

  const merchantMatch = merchantDistance === 0;
  const amountMatch = amountDifference <= tolerance;

  if (merchantMatch && amountMatch) {
    return {
      isDuplicate: true,
      similarity: "exact",
      merchantDistance,
      amountDifference,
    };
  }

  if (merchantDistance <= maxDist && amountMatch) {
    return {
      isDuplicate: true,
      similarity: "fuzzy",
      merchantDistance,
      amountDifference,
    };
  }

  return {
    isDuplicate: false,
    similarity: "none",
    merchantDistance,
    amountDifference,
  };
}
