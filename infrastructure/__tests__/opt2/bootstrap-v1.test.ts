/**
 * bootstrap-v1.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates Option 2 (LocalStack Bootstrap) provisioning for REST API v1.
 * 
 * Scope:
 * - API Gateway v1 (REST API) hierarchical resource tree
 * - All 18 registered resources (no {proxy+} — explicit resources)
 * - CORS OPTIONS mock integration on every resource
 * - HTTP-level routing: every path must reach Lambda (not 404 at Gateway)
 * - Lambda build artifact integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

const ENDPOINT = "http://localhost:4566";
const REGION = "us-east-1";
const API_NAME = "costscrunch-dev-api";

// Full route registry — must match bootstrap.sh add_route() calls
const REQUIRED_RESOURCE_PATHS = [
  "/groups",
  "/groups/{id}",
  "/groups/{id}/balances",
  "/groups/{id}/members",
  "/groups/{id}/members/{userId}",
  "/groups/{id}/settle",
  "/expenses",
  "/expenses/{id}",
  "/receipts",
  "/receipts/upload-url",
  "/receipts/{expenseId}/scan",
  "/analytics",
  "/analytics/summary",
  "/analytics/trends",
  "/analytics/chart-data",
  "/health",
] as const;

// Concrete paths to HTTP-test through the Gateway (stand in for {id} params)
const HTTP_TEST_PATHS = [
  "/groups",
  "/groups/test-group-id",
  "/groups/test-group-id/balances",
  "/groups/test-group-id/members",
  "/groups/test-group-id/members/test-user-id",
  "/groups/test-group-id/settle",
  "/expenses",
  "/expenses/test-expense-id",
  "/receipts",
  "/receipts/upload-url",
  "/receipts/test-expense-id/scan",
  "/analytics",
  "/analytics/summary",
  "/analytics/trends",
  "/analytics/chart-data",
  "/health",
] as const;

let localstackHealthy = false;

beforeAll(async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${ENDPOINT}/_localstack/health`, { signal: controller.signal });
    localstackHealthy = res.ok;
    clearTimeout(timeoutId);
  } catch (err: any) {
    try {
      execSync(`nc -z localhost 4566`);
      localstackHealthy = true;
    } catch {
      console.warn("[bootstrap-v1.test] LocalStack health check failed:", err.message);
      localstackHealthy = false;
    }
  }
});

function aws(args: string): string {
  return execSync(
    `docker exec costscrunch-localstack /usr/local/bin/aws --endpoint-url=http://localhost:4566 --region ${REGION} --output json ${args}`,
    { encoding: "utf-8", timeout: 10_000 }
  );
}

describe.skipIf(!localstackHealthy)("Infrastructure: REST API v1 Bootstrap", () => {
  let apiId: string;
  let stageUrl: string;

  beforeAll(() => {
    const apis = JSON.parse(aws("apigateway get-rest-apis")).items;
    const api = apis.find((a: any) => a.name === API_NAME);
    expect(api).toBeDefined();
    apiId = api.id;
    stageUrl = `${ENDPOINT}/restapis/${apiId}/local/_user_request_`;
  });

  // ── Resource Tree Structure ──────────────────────────────────────────────

  describe("API Gateway resource tree", () => {
    it("should have all 16 required resources in the hierarchy", () => {
      const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;
      const paths = resources.map((r: any) => r.path);

      const missing = REQUIRED_RESOURCE_PATHS.filter((p) => !paths.includes(p));
      expect(missing, `Missing API Gateway resources: ${missing.join(", ")}`).toHaveLength(0);
    });

    it("should NOT use {proxy+} — all routes are explicit resources", () => {
      const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;
      const paths = resources.map((r: any) => r.path);

      expect(paths).not.toContain("/groups/{proxy+}");
      expect(paths).not.toContain("/expenses/{proxy+}");
      expect(paths).not.toContain("/{proxy+}");
    });

    it("should have correct parent-child relationships (nested resources)", () => {
      const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;
      const byId = Object.fromEntries(resources.map((r: any) => [r.id, r]));

      // /groups/{id} must be a child of /groups
      const groupsRes = resources.find((r: any) => r.path === "/groups");
      const groupsChild = resources.find((r: any) => r.path === "/groups/{id}");
      expect(groupsChild).toBeDefined();
      expect(groupsChild.parentId).toBe(groupsRes.id);

      // /groups/{id}/balances must be a child of /groups/{id}
      const balancesRes = resources.find((r: any) => r.path === "/groups/{id}/balances");
      expect(balancesRes).toBeDefined();
      expect(balancesRes.parentId).toBe(groupsChild.id);

      // /analytics/summary must be a child of /analytics
      const analyticsRes = resources.find((r: any) => r.path === "/analytics");
      const summaryRes = resources.find((r: any) => r.path === "/analytics/summary");
      expect(summaryRes).toBeDefined();
      expect(summaryRes.parentId).toBe(analyticsRes.id);
    });
  });

  // ── CORS: OPTIONS Mock Integration ──────────────────────────────────────

  describe("CORS preflight (OPTIONS mock)", () => {
    it("should have OPTIONS MOCK integration on every resource", () => {
      const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;

      const missingOptions: string[] = [];
      for (const res of resources) {
        if (!res.resourceMethods?.OPTIONS) {
          missingOptions.push(res.path);
          continue;
        }
        const method = JSON.parse(aws(
          `apigateway get-method --rest-api-id ${apiId} --resource-id ${res.id} --http-method OPTIONS`
        ));
        expect(method.methodIntegration.type, `OPTIONS on ${res.path} is not MOCK`).toBe("MOCK");
      }

      expect(missingOptions, `Missing OPTIONS method on: ${missingOptions.join(", ")}`).toHaveLength(0);
    });

    it("should return CORS headers in OPTIONS integration response", () => {
      const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;

      for (const res of resources) {
        if (!res.resourceMethods?.OPTIONS) continue;

        const intRes = JSON.parse(aws(
          `apigateway get-integration-response --rest-api-id ${apiId} --resource-id ${res.id} --http-method OPTIONS --status-code 200`
        ));

        expect(intRes.responseParameters["method.response.header.Access-Control-Allow-Origin"], `Missing CORS origin on ${res.path}`).toBeDefined();
        expect(intRes.responseParameters["method.response.header.Access-Control-Allow-Methods"], `Missing CORS methods on ${res.path}`).toBeDefined();
        expect(intRes.responseParameters["method.response.header.Access-Control-Allow-Headers"], `Missing CORS headers on ${res.path}`).toBeDefined();
      }
    });
  });

  // ── HTTP-Level Routing (catches "404 before Lambda") ───────────────────

  describe("HTTP routing through API Gateway", () => {
    it.each(HTTP_TEST_PATHS)(
      "GET %s should NOT return a Gateway 404 (Missing Resource)",
      async (path) => {
        const res = await fetch(`${stageUrl}${path}`, {
          method: "GET",
          headers: { Origin: "http://localhost:3000" },
        });

        // A Gateway 404 returns a body like {"message": "Missing Authentication Token"}
        // or {"message": null} — NOT a Lambda JSON response.
        // Lambda responses always have a structured body. Gateway 404s do not.
        const body = await res.text();
        const isGateway404 = res.status === 403 && !body.includes('"error"');

        expect(isGateway404, `${path} returned Gateway 403/404 (resource not found). Body: ${body.slice(0, 200)}`).toBe(false);

        // We accept any status from Lambda (200, 400, 401, 500) — just not a Gateway-level miss
        expect(res.status, `${path} returned unexpected status`).not.toBe(404);
      }
    );

    it.each(HTTP_TEST_PATHS)(
      "OPTIONS %s should return CORS headers (not 404)",
      async (path) => {
        const res = await fetch(`${stageUrl}${path}`, {
          method: "OPTIONS",
          headers: {
            Origin: "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
          },
        });

        expect(res.status, `OPTIONS ${path} returned ${res.status} — resource likely missing`).not.toBe(404);
        expect(res.headers.get("access-control-allow-origin"), `Missing CORS origin on OPTIONS ${path}`).toBe("*");
        expect(res.headers.get("access-control-allow-methods"), `Missing CORS methods on OPTIONS ${path}`).not.toBeNull();
      }
    );
  });

  // ── Lambda Integration ──────────────────────────────────────────────────

  it("should point to bundled index.handler (not source wrapper)", () => {
    const fn = JSON.parse(aws("lambda get-function --function-name GroupsFunction"));
    expect(fn.Configuration.Handler).toBe("index.handler");
  });

  it("should have all 7 Lambda functions deployed", () => {
    const fns = JSON.parse(aws("lambda list-functions")).Functions;
    const names = fns.map((f: any) => f.FunctionName);

    const required = [
      "GroupsFunction", "ExpensesFunction", "ReceiptsFunction",
      "AnalyticsFunction", "SnsWebhookFunction", "WsNotifierFunction", "HealthFunction",
    ];
    const missing = required.filter((n) => !names.includes(n));
    expect(missing, `Missing Lambda functions: ${missing.join(", ")}`).toHaveLength(0);
  });
});
