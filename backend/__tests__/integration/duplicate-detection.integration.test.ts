import { describe, it, expect } from "vitest";
import { computeReceiptHash } from "../../src/utils/receiptHash.js";
import { fuzzyMatchReceipt } from "../../src/utils/fuzzyMatch.js";

describe("Duplicate Receipt Detection Integration", () => {
  describe("computeReceiptHash", () => {
    it("generates consistent hash for exact duplicate inputs", () => {
      const hash1 = computeReceiptHash("STARBUCKS", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("starbucks", "2024-01-15", 12.99);
      expect(hash1).toBe(hash2);
    });

    it("generates different hash for unique receipt", () => {
      const hash1 = computeReceiptHash("STARBUCKS", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("DUNKIN", "2024-01-15", 12.99);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("fuzzyMatchReceipt", () => {
    it("flags exact duplicate as isDuplicate=true with similarity=exact", () => {
      const result = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 12.99);
      expect(result.isDuplicate).toBe(true);
      expect(result.similarity).toBe("exact");
      expect(result.merchantDistance).toBe(0);
      expect(result.amountDifference).toBe(0);
    });

    it("flags fuzzy duplicate when merchant names are similar within threshold", () => {
      // "STARBUCKS" vs "STARBUCKS #1234" - distance is 6 (within default threshold of 10)
      const result = fuzzyMatchReceipt("STARBUCKS #1234", "STARBUCKS", 12.99, 12.99);
      expect(result.isDuplicate).toBe(true);
      expect(result.similarity).toBe("fuzzy");
      expect(result.merchantDistance).toBeLessThanOrEqual(10);
    });

    it("blocks unique receipt (no duplicate)", () => {
      const result = fuzzyMatchReceipt("Starbucks Coffee Shop", "Dunkin Donuts", 12.99, 15.00);
      expect(result.isDuplicate).toBe(false);
      expect(result.similarity).toBe("none");
    });

    it("respects amount tolerance of ±$0.50", () => {
      // Amount within tolerance
      const withinTolerance = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 12.50);
      expect(withinTolerance.amountDifference).toBeCloseTo(0.49, 2);
      expect(withinTolerance.similarity).toBe("exact");

      // Amount outside tolerance
      const outsideTolerance = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 13.50);
      expect(outsideTolerance.amountDifference).toBeCloseTo(0.51, 2);
      expect(outsideTolerance.similarity).toBe("none");
    });
  });

  describe("ReceiptHashIndex query simulation", () => {
    it("would query ReceiptHashIndex with receiptHash partition key", () => {
      const receiptHash = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const queryParams = {
        TableName: "costscrunch-dev-main",
        IndexName: "ReceiptHashIndex",
        KeyConditionExpression: "receiptHash = :hash",
        ExpressionAttributeValues: {
          ":hash": receiptHash,
        },
        Limit: 1,
      };

      // Verify the hash is deterministic
      expect(queryParams.ExpressionAttributeValues[":hash"]).toMatch(/^[a-f0-9]{64}$/);

      // Same inputs should produce same hash
      const hash2 = computeReceiptHash("STARBUCKS", "2024-01-15", 12.99);
      expect(queryParams.ExpressionAttributeValues[":hash"]).toBe(hash2);
    });

    it("different inputs produce different hashes", () => {
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("Starbucks", "2024-01-16", 12.99);
      const hash3 = computeReceiptHash("Starbucks", "2024-01-15", 13.00);
      const hash4 = computeReceiptHash("Dunkin", "2024-01-15", 12.99);

      expect(new Set([hash1, hash2, hash3, hash4]).size).toBe(4);
    });
  });

  describe("Duplicate detection response shape", () => {
    it("returns correct shape for exact duplicate", () => {
      const result = fuzzyMatchReceipt("Starbucks", "Starbucks", 12.99, 12.99);
      expect(result).toHaveProperty("isDuplicate");
      expect(result).toHaveProperty("similarity");
      expect(result).toHaveProperty("merchantDistance");
      expect(result).toHaveProperty("amountDifference");
      expect(["exact", "fuzzy", "none"]).toContain(result.similarity);
    });

    it("returns correct shape for fuzzy duplicate", () => {
      const result = fuzzyMatchReceipt("STARBUCKS #5678", "STARBUCKS", 12.99, 12.99);
      expect(result.isDuplicate).toBe(true);
      expect(["exact", "fuzzy"]).toContain(result.similarity);
    });

    it("returns correct shape for no duplicate", () => {
      const result = fuzzyMatchReceipt("Starbucks Coffee Shop", "Dunkin Donuts", 12.99, 12.99);
      expect(result.isDuplicate).toBe(false);
      expect(result.similarity).toBe("none");
    });
  });
});
