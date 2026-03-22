/**
 * cors.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that every API route returns correct CORS headers on OPTIONS preflight
 * and on actual requests. Tests the Express layer (local dev path).
 *
 * Production CORS is handled by CloudFront ResponseHeadersPolicy — not testable
 * here (requires deployed CF distribution). Use CDK snapshot tests for that.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "http";

// Mock the Lambda handlers before importing app to avoid real AWS SDK calls
vi.mock("../../src/lambdas/expenses/index.js", () => ({
  rawHandler: vi.fn(() => Promise.resolve({ statusCode: 200, body: JSON.stringify({ mocked: true }), headers: {} }))
}));
vi.mock("../../src/lambdas/groups/index.js", () => ({
  handler: vi.fn(() => Promise.resolve({ statusCode: 200, body: JSON.stringify({ mocked: true }), headers: { "Content-Type": "application/json" } }))
}));
vi.mock("../../src/lambdas/analytics/index.js", () => ({
  handler: vi.fn(() => Promise.resolve({ statusCode: 200, body: JSON.stringify({ mocked: true }), headers: {} }))
}));

import { app } from "../../src/server.js";

const TEST_PORT = 4001;
const BASE = `http://localhost:${TEST_PORT}`;

let server: ReturnType<typeof createServer>;

// ── All routes that should respond to OPTIONS preflight ───────────────────────
const CORS_ROUTES: ReadonlyArray<[string, string]> = [
  // [method, path]
  ["OPTIONS", "/expenses"],
  ["OPTIONS", "/expenses/test-id"],
  ["OPTIONS", "/groups"],
  ["OPTIONS", "/groups/test-id"],
  ["OPTIONS", "/groups/test-id/balances"],
  ["OPTIONS", "/groups/test-id/members"],
  ["OPTIONS", "/groups/test-id/members/test-uid"],
  ["OPTIONS", "/groups/test-id/settle"],
  ["OPTIONS", "/analytics"],
  ["OPTIONS", "/analytics/summary"],
  ["OPTIONS", "/analytics/trends"],
  ["OPTIONS", "/analytics/chart-data"],
  ["OPTIONS", "/receipts"],
  ["OPTIONS", "/receipts/upload-url"],
  ["OPTIONS", "/receipts/test-id/scan"],
];

// Headers that MUST be present on every CORS response
const REQUIRED_CORS_HEADERS = [
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
] as const;

// Values that must appear in the respective headers
const EXPECTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const EXPECTED_HEADERS = ["Authorization", "Content-Type", "X-Idempotency-Key"];

beforeAll(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(TEST_PORT, () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ─────────────────────────────────────────────────────────────────────────────

describe("CORS preflight — OPTIONS on all routes", () => {
  it.each(CORS_ROUTES)(
    "OPTIONS %s returns correct CORS headers for %s",
    async (_method, path) => {
      const res = await fetch(`${BASE}${path}`, { method: "OPTIONS" });

      // OPTIONS should return 204 (No Content), not 200
      expect(res.status, `Expected 204 on OPTIONS ${path}, got ${res.status}`).toBe(204);

      // All required CORS headers must be present
      for (const header of REQUIRED_CORS_HEADERS) {
        expect(
          res.headers.get(header),
          `Missing ${header} on OPTIONS ${path}`
        ).not.toBeNull();
      }

      // Origin must be wildcard (local dev config)
      expect(res.headers.get("access-control-allow-origin")).toBe("*");

      // All expected methods must be listed
      const methodsHeader = res.headers.get("access-control-allow-methods")!;
      for (const m of EXPECTED_METHODS) {
        expect(methodsHeader, `Missing ${m} in Allow-Methods on OPTIONS ${path}`).toContain(m);
      }

      // All expected headers must be listed
      const headersHeader = res.headers.get("access-control-allow-headers")!;
      for (const h of EXPECTED_HEADERS) {
        expect(headersHeader, `Missing ${h} in Allow-Headers on OPTIONS ${path}`).toContain(h);
      }
    }
  );
});

describe("CORS headers on actual requests (non-OPTIONS)", () => {
  it("GET /groups includes CORS headers with Origin header", async () => {
    const res = await fetch(`${BASE}/groups`, {
      headers: { Origin: "http://localhost:5173" },
    });

    // Status doesn't matter — CORS headers should be present regardless
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).not.toBeNull();
    expect(res.headers.get("access-control-allow-headers")).not.toBeNull();
  });

  it("POST /expenses includes CORS headers", async () => {
    const res = await fetch(`${BASE}/expenses`, {
      method: "POST",
      headers: { Origin: "http://localhost:5173" },
      body: JSON.stringify({}), // will fail validation, but CORS headers should still be present
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("GET /analytics/summary includes CORS headers", async () => {
    const res = await fetch(`${BASE}/analytics/summary`, {
      headers: { Origin: "http://localhost:5173" },
    });

    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("Lambda CORS headers are stripped — Express is the authority", () => {
  it("response headers match Express cors() config, not Lambda's Content-Type override", async () => {
    // The groups handler returns { "Content-Type": "application/json" }.
    // Express cors() should still control CORS — no interference from Lambda headers.
    const res = await fetch(`${BASE}/groups`, {
      headers: { Origin: "http://localhost:5173" },
    });

    // CORS comes from Express middleware
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    // Content-Type comes from Lambda (set via res.set(safeHeaders))
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
