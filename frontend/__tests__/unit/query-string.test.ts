import { describe, it, expect } from "vitest";
import { toQueryString } from "../../src/helpers/queryString";

describe("toQueryString", () => {
  it("returns an empty string when params is undefined", () => {
    expect(toQueryString(undefined)).toBe("");
  });

  it("returns an empty string for an empty object", () => {
    expect(toQueryString({})).toBe("");
  });

  it("skips null and undefined values", () => {
    const qs = toQueryString({ a: 1, b: undefined, c: null, d: "x" });
    expect(qs).toBe("?a=1&d=x");
  });

  it("joins multiple params with &", () => {
    const qs = toQueryString({ status: "approved", category: "Travel", limit: 10 });
    expect(qs).toBe("?status=approved&category=Travel&limit=10");
  });
});
