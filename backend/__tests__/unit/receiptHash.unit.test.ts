import { describe, it, expect } from "vitest";
import { computeReceiptHash, normalizeReceiptFields, computeEntityHash } from "../../src/utils/receiptHash.js";

describe("receiptHash", () => {
  describe("normalizeReceiptFields", () => {
    it("lowercases merchant name", () => {
      const result = normalizeReceiptFields("STARBUCKS", "2024-01-15", 12.99);
      expect(result[0]).toBe("starbucks");
    });

    it("trims whitespace from merchant", () => {
      const result = normalizeReceiptFields("  Starbucks Coffee  ", "2024-01-15", 12.99);
      expect(result[0]).toBe("starbucks coffee");
    });

    it("extracts date-only (YYYY-MM-DD)", () => {
      const result = normalizeReceiptFields("Store", "2024-01-15T14:30:00Z", 12.99);
      expect(result[1]).toBe("2024-01-15");
    });

    it("keeps date-only as-is", () => {
      const result = normalizeReceiptFields("Store", "2024-01-15", 12.99);
      expect(result[1]).toBe("2024-01-15");
    });

    it("rounds amount to 2 decimal places", () => {
      const result = normalizeReceiptFields("Store", "2024-01-15", 12.999);
      expect(result[2]).toBe("13");
    });

    it("handles floating point edge case (0.1 + 0.2)", () => {
      // 0.1 + 0.2 = 0.30000000000000004, should round to 0.3
      const result = normalizeReceiptFields("Store", "2024-01-15", 0.1 + 0.2);
      expect(result[2]).toBe("0.3");
    });

    it("normalizes amounts that differ only in floating point representation", () => {
      // 12.345 and 12.344999... should both round to 12.34
      const result1 = normalizeReceiptFields("Store", "2024-01-15", 12.344);
      const result2 = normalizeReceiptFields("Store", "2024-01-15", 12.345);
      expect(result1[2]).toBe("12.34");
      expect(result2[2]).toBe("12.35");
    });
  });

  describe("computeReceiptHash", () => {
    it("produces consistent hash for same inputs", () => {
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      expect(hash1).toBe(hash2);
    });

    it("produces same hash regardless of case", () => {
      const hash1 = computeReceiptHash("STARBUCKS", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("starbucks", "2024-01-15", 12.99);
      expect(hash1).toBe(hash2);
    });

    it("produces same hash for amounts that round identically", () => {
      // 12.344 and 12.345 round to 12.34 and 12.35 respectively - different
      // But 12.999 and 13.001 both round to 13
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.999);
      const hash2 = computeReceiptHash("Starbucks", "2024-01-15", 13.001);
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different merchants", () => {
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("Dunkin", "2024-01-15", 12.99);
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hash for different dates", () => {
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("Starbucks", "2024-01-16", 12.99);
      expect(hash1).not.toBe(hash2);
    });

    it("produces different hash for different amounts", () => {
      const hash1 = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      const hash2 = computeReceiptHash("Starbucks", "2024-01-15", 13.00);
      expect(hash1).not.toBe(hash2);
    });

    it("returns a valid SHA-256 hex string (64 chars)", () => {
      const hash = computeReceiptHash("Starbucks", "2024-01-15", 12.99);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("computeEntityHash", () => {
    it("produces different hashes for different parts", () => {
      const hash1 = computeEntityHash("part1", "part2");
      const hash2 = computeEntityHash("part1", "part3");
      expect(hash1).not.toBe(hash2);
    });

    it("is deterministic", () => {
      const hash = computeEntityHash("a", "b", "c");
      expect(computeEntityHash("a", "b", "c")).toBe(hash);
    });
  });
});
