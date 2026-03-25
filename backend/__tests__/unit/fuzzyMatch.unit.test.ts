import { describe, it, expect } from "vitest";
import { levenshtein, fuzzyMatchReceipt, type FuzzyMatchResult } from "../../src/utils/fuzzyMatch";

describe("fuzzyMatch", () => {
  describe("levenshtein", () => {
    it("returns 0 for identical strings", () => {
      expect(levenshtein("hello", "hello")).toBe(0);
    });

    it("returns length for empty string comparison", () => {
      expect(levenshtein("", "hello")).toBe(5);
      expect(levenshtein("hello", "")).toBe(5);
    });

    it("handles single character substitution", () => {
      expect(levenshtein("cat", "bat")).toBe(1);
    });

    it("handles insertion", () => {
      expect(levenshtein("cat", "cats")).toBe(1);
    });

    it("handles deletion", () => {
      expect(levenshtein("cats", "cat")).toBe(1);
    });

    it("handles case sensitivity", () => {
      expect(levenshtein("CAT", "cat")).toBe(3);
    });

    it("handles completely different strings", () => {
      expect(levenshtein("abc", "xyz")).toBe(3);
    });

    it("handles similar merchant names", () => {
      // "STARBUCKS" vs "STARBUCKS COFFEE" - requires inserting " COFFEE" (7 chars)
      const distance = levenshtein("STARBUCKS", "STARBUCKS COFFEE");
      expect(distance).toBe(7);
    });

    it("handles store variations", () => {
      expect(levenshtein("WALMART", "WAL-MART")).toBe(1);
    });
  });

  describe("fuzzyMatchReceipt", () => {
    describe("exact match (same merchant + amount within tolerance)", () => {
      it("returns exact similarity for identical merchant and amount", () => {
        const result = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 12.99);
        expect(result.similarity).toBe("exact");
        expect(result.isDuplicate).toBe(true);
        expect(result.merchantDistance).toBe(0);
        expect(result.amountDifference).toBe(0);
      });

      it("returns exact for same merchant with amount within tolerance", () => {
        const result = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 12.75);
        expect(result.similarity).toBe("exact");
        expect(result.isDuplicate).toBe(true);
        expect(result.amountDifference).toBeCloseTo(0.24);
      });

      it("returns exact for case-insensitive merchant match", () => {
        const result = fuzzyMatchReceipt("STARBUCKS", "starbucks", 12.99, 12.99);
        expect(result.similarity).toBe("exact");
        expect(result.merchantDistance).toBe(0);
      });

      it("returns exact for whitespace-trimmed merchant match", () => {
        const result = fuzzyMatchReceipt("  Starbucks  ", "Starbucks", 12.99, 12.99);
        expect(result.similarity).toBe("exact");
        expect(result.merchantDistance).toBe(0);
      });
    });

    describe("fuzzy match (similar merchant + amount within tolerance)", () => {
      it("returns fuzzy for similar merchants with same amount", () => {
        // "STARBUCKS" vs "STARBUCKS #1234" - distance of 6 (space + # + 4 digits)
        const result = fuzzyMatchReceipt("STARBUCKS #1234", "STARBUCKS", 12.99, 12.99);
        expect(result.similarity).toBe("fuzzy");
        expect(result.isDuplicate).toBe(true);
        expect(result.merchantDistance).toBeLessThanOrEqual(10);
      });

      it("returns fuzzy for store variations with amount within tolerance", () => {
        const result = fuzzyMatchReceipt("WAL-MART", "WALMART", 100.00, 100.25);
        expect(result.similarity).toBe("fuzzy");
        expect(result.isDuplicate).toBe(true);
        expect(result.amountDifference).toBeLessThanOrEqual(0.50);
      });

      it("returns fuzzy for minor typos within distance threshold", () => {
        const result = fuzzyMatchReceipt("Starbucls", "Starbucks", 12.99, 12.99);
        expect(result.similarity).toBe("fuzzy");
        expect(result.merchantDistance).toBe(1);
      });

      it("returns none when merchants are too different", () => {
        // "Starbucks" vs "McDonalds" - distance is 8, within threshold, but test for when merchant names differ significantly
        const result = fuzzyMatchReceipt("Starbucks Coffee", "McDonalds", 12.99, 12.99);
        expect(result.similarity).toBe("none");
        expect(result.isDuplicate).toBe(false);
      });
    });

    describe("no match (amount outside tolerance)", () => {
      it("returns none when amounts differ by more than tolerance", () => {
        const result = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 15.00);
        expect(result.similarity).toBe("none");
        expect(result.isDuplicate).toBe(false);
        expect(result.amountDifference).toBeGreaterThan(0.50);
      });

      it("returns none for different merchant and different amount", () => {
        const result = fuzzyMatchReceipt("Starbucks", "Dunkin", 12.99, 15.00);
        expect(result.similarity).toBe("none");
        expect(result.isDuplicate).toBe(false);
      });
    });

    describe("custom tolerance options", () => {
      it("respects custom maxMerchantDistance", () => {
        const result = fuzzyMatchReceipt(
          "STARBUCKS COFFEE #5678",
          "STARBUCKS",
          12.99,
          12.99,
          { maxMerchantDistance: 5 }
        );
        expect(result.similarity).toBe("none");
        expect(result.merchantDistance).toBeGreaterThan(5);
      });

      it("respects custom amountTolerance", () => {
        const result = fuzzyMatchReceipt(
          "Starbucks",
          "Starbucks",
          12.99,
          13.25,
          { amountTolerance: 0.50 }
        );
        expect(result.amountDifference).toBeCloseTo(0.26, 2);
        expect(result.amountDifference).toBeLessThanOrEqual(0.50);
        expect(result.similarity).toBe("exact");
      });

      it("rejects when amount difference exceeds custom tolerance", () => {
        const result = fuzzyMatchReceipt(
          "Starbucks",
          "Starbucks",
          12.99,
          13.75,
          { amountTolerance: 0.50 }
        );
        expect(result.amountDifference).toBeCloseTo(0.76, 2);
        expect(result.amountDifference).toBeGreaterThan(0.50);
        expect(result.similarity).toBe("none");
      });
    });

    describe("edge cases", () => {
      it("handles zero amount", () => {
        const result = fuzzyMatchReceipt("Store", "Store", 0, 0);
        expect(result.similarity).toBe("exact");
      });

      it("handles very small amounts", () => {
        const result = fuzzyMatchReceipt("Store", "Store", 0.01, 0.01);
        expect(result.similarity).toBe("exact");
      });

      it("handles large amounts", () => {
        const result = fuzzyMatchReceipt("Store", "Store", 9999.99, 9999.99);
        expect(result.similarity).toBe("exact");
      });

      it("handles empty merchant strings", () => {
        const result = fuzzyMatchReceipt("", "", 12.99, 12.99);
        expect(result.similarity).toBe("exact");
        expect(result.merchantDistance).toBe(0);
      });
    });
  });
});
