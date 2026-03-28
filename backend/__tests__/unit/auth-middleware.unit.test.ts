import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: class {
    info = vi.fn();
    error = vi.fn();
  },
}));

import {
  verifyToken,
  extractUserId,
  withAuth,
} from "../../src/shared/auth/middleware.js";
import { extractClaims, extractGroups, isTokenExpired } from "../../src/shared/auth/jwtUtils.js";

// A valid JWT with payload: { sub: "user-123", email: "u@t.com", iat: 1700000000 }
// No exp claim → never expires
const VALID_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(JSON.stringify({
    sub: "user-123",
    email: "u@t.com",
    iat: 1700000000,
  })).toString("base64url") +
  ".fake-signature";

// Expired JWT with exp in the past
const EXPIRED_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(JSON.stringify({
    sub: "user-123",
    email: "u@t.com",
    iat: 1700000000,
    exp: 1700000001,
  })).toString("base64url") +
  ".fake-signature";

// JWT with cognito:groups
const GROUPS_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(JSON.stringify({
    sub: "user-456",
    email: "admin@t.com",
    "cognito:groups": "admins,pro",
    iat: 1700000000,
  })).toString("base64url") +
  ".fake-signature";

describe("JWT utilities (jwtUtils)", () => {
  describe("extractClaims", () => {
    it("extracts claims from a valid JWT", () => {
      const claims = extractClaims(VALID_TOKEN);
      expect(claims.sub).toBe("user-123");
      expect(claims.email).toBe("u@t.com");
      expect(claims.iat).toBe(1700000000);
    });

    it("throws on malformed JWT (wrong number of parts)", () => {
      expect(() => extractClaims("not-a-jwt")).toThrow("Invalid JWT format");
    });

    it("throws on JWT with invalid base64 payload", () => {
      expect(() => extractClaims("a.!!!invalid!!!.c")).toThrow("Invalid JWT format");
    });
  });

  describe("extractGroups", () => {
    it("extracts groups from cognito:groups claim", () => {
      const claims = extractClaims(GROUPS_TOKEN);
      const groups = extractGroups(claims);
      expect(groups).toEqual(["admins", "pro"]);
    });

    it("returns empty array when no groups claim", () => {
      const claims = extractClaims(VALID_TOKEN);
      expect(extractGroups(claims)).toEqual([]);
    });

    it("handles array-style groups", () => {
      const claims = { sub: "u1", "cognito:groups": ["a", "b"] as any };
      expect(extractGroups(claims)).toEqual(["a", "b"]);
    });
  });

  describe("isTokenExpired", () => {
    it("returns false when no exp claim", () => {
      const claims = extractClaims(VALID_TOKEN);
      expect(isTokenExpired(claims)).toBe(false);
    });

    it("returns true when token is expired", () => {
      const claims = extractClaims(EXPIRED_TOKEN);
      expect(isTokenExpired(claims)).toBe(true);
    });

    it("returns false for future exp", () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const claims = { sub: "u1", exp: futureExp };
      expect(isTokenExpired(claims)).toBe(false);
    });
  });
});

describe("Auth middleware", () => {
  describe("verifyToken", () => {
    it("extracts claims from valid Authorization: Bearer token", async () => {
      const event = { headers: { Authorization: `Bearer ${VALID_TOKEN}` } };
      const claims = await verifyToken(event);
      expect(claims.sub).toBe("user-123");
      expect(claims.email).toBe("u@t.com");
    });

    it("supports lowercase authorization header", async () => {
      const event = { headers: { authorization: `Bearer ${VALID_TOKEN}` } };
      const claims = await verifyToken(event);
      expect(claims.sub).toBe("user-123");
    });

    it("throws on missing Authorization header", async () => {
      await expect(verifyToken({ headers: {} })).rejects.toThrow(
        "Missing Authorization header",
      );
    });

    it("throws on invalid Bearer format", async () => {
      await expect(
        verifyToken({ headers: { Authorization: "Basic abc" } }),
      ).rejects.toThrow("Invalid Authorization header format");
    });

    it("throws on expired token", async () => {
      await expect(
        verifyToken({ headers: { Authorization: `Bearer ${EXPIRED_TOKEN}` } }),
      ).rejects.toThrow("Token expired");
    });
  });

  describe("extractUserId", () => {
    it("returns sub from JWT claims", () => {
      expect(extractUserId({ sub: "user-abc" })).toBe("user-abc");
    });

    it("throws when sub is missing", () => {
      expect(() => extractUserId({} as any)).toThrow("Missing sub claim");
    });
  });

  describe("withAuth", () => {
    it("injects claims into event requestContext on valid token", async () => {
      const innerHandler = vi.fn().mockResolvedValue({ statusCode: 200 });
      const wrapped = withAuth(innerHandler);

      await wrapped(
        { headers: { Authorization: `Bearer ${VALID_TOKEN}` } } as any,
        {} as any,
      );

      expect(innerHandler).toHaveBeenCalledTimes(1);
      const enrichedEvent = innerHandler.mock.calls[0][0];
      expect(enrichedEvent.requestContext.authorizer.jwt.claims.sub).toBe("user-123");
    });

    it("returns 401 on missing auth header", async () => {
      const innerHandler = vi.fn();
      const wrapped = withAuth(innerHandler);

      const result = await wrapped({ headers: {} } as any, {} as any);

      expect(innerHandler).not.toHaveBeenCalled();
      expect(result).toEqual({
        statusCode: 401,
        body: JSON.stringify({ message: "Missing Authorization header" }),
      });
    });

    it("returns 401 on expired token", async () => {
      const innerHandler = vi.fn();
      const wrapped = withAuth(innerHandler);

      const result = await wrapped(
        { headers: { Authorization: `Bearer ${EXPIRED_TOKEN}` } } as any,
        {} as any,
      );

      expect(innerHandler).not.toHaveBeenCalled();
      expect(result).toEqual({
        statusCode: 401,
        body: JSON.stringify({ message: "Token expired" }),
      });
    });
  });
});
