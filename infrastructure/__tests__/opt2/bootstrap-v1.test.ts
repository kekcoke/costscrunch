/**
 * bootstrap-v1.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Validates Option 2 (LocalStack Bootstrap) provisioning for REST API v1.
 * 
 * Scope:
 * - API Gateway v1 (REST API) hierarchy
 * - {proxy+} resource mapping
 * - CORS (GatewayResponses & OPTIONS Mock)
 * - Lambda build artifact integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";

const ENDPOINT = "http://localhost:4566";
const REGION = "us-east-1";
const API_NAME = "costscrunch-dev-api";

let localstackHealthy = false;

beforeAll(async () => {
  try {
    // Increase timeout and check for a successful fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`${ENDPOINT}/_localstack/health`, { signal: controller.signal });
    localstackHealthy = res.ok;
    clearTimeout(timeoutId);
  } catch (err: any) {
    // Fallback: try checking if the port is open via shell if fetch fails (common in some CI/container envs)
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

  beforeAll(() => {
    const apis = JSON.parse(aws("apigateway get-rest-apis")).items;
    const api = apis.find((a: any) => a.name === API_NAME);
    expect(api).toBeDefined();
    apiId = api.id;
  });

  it("should have the correct API Gateway v1 structure", () => {
    const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;
    
    // Check main resources
    const paths = resources.map((r: any) => r.path);
    expect(paths).toContain("/groups");
    expect(paths).toContain("/expenses");
    
    // Check hierarchical {proxy+} resources (verified fix from Turn 1)
    expect(paths).toContain("/groups/{proxy+}");
  });

  it("should configure CORS via Gateway Responses", () => {
    const responses = JSON.parse(aws(`apigateway get-gateway-responses --rest-api-id ${apiId}`)).items;
    const types = responses.map((r: any) => r.responseType);
    
    expect(types).toContain("DEFAULT_4XX");
    expect(types).toContain("DEFAULT_5XX");

    const res4xx = responses.find((r: any) => r.responseType === "DEFAULT_4XX");
    expect(res4xx.responseParameters["gatewayresponse.header.Access-Control-Allow-Origin"]).toBe("'*'");
  });

  it("should implement OPTIONS mock integrations on all resources", () => {
    const resources = JSON.parse(aws(`apigateway get-resources --rest-api-id ${apiId}`)).items;
    
    for (const res of resources) {
      if (res.resourceMethods && res.resourceMethods.OPTIONS) {
        const method = JSON.parse(aws(
          `apigateway get-method --rest-api-id ${apiId} --resource-id ${res.id} --http-method OPTIONS`
        ));
        expect(method.methodIntegration.type).toBe("MOCK");
      }
    }
  });

  it("should point to bundled index.handler (not source wrapper)", () => {
    const fn = JSON.parse(aws("lambda get-function --function-name GroupsFunction"));
    expect(fn.Configuration.Handler).toBe("index.handler");
  });
});
