/**
 * sam-template-v1.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates SAM template alignment with REST API v1.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TEMPLATE_PATH = resolve(__dirname, "../../sam/template-arm.yaml");

describe("Infrastructure: SAM REST v1 Template", () => {
  let template: string;

  beforeAll(() => {
    template = readFileSync(TEMPLATE_PATH, "utf-8");
  });

  it("should use REST API (v1) configuration instead of HttpApi", () => {
    // REST API v1 uses 'Api:' in Globals or 'AWS::Serverless::Api' for resources.
    // HTTP API v2 uses 'HttpApi:'.
    expect(template).toContain("Api:");
    expect(template).not.toContain("HttpApi:");
  });

  it("should define proxy resources for catch-all routing", () => {
    // Look for {proxy+} in path definitions (using dotAll or searching for the literal)
    expect(template).toContain("{proxy+}");
  });

  it("should contain explicit CORS headers in response configurations", () => {
    expect(template).toContain("Access-Control-Allow-Origin");
  });
});
