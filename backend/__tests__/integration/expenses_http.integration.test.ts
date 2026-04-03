import axios from "axios";
import { execSync } from "child_process";
import { ulid } from "ulid";
import { describe, it, expect } from "vitest";

const getBaseUrl = (): string => {
  const envUrl = process.env.VITE_API_URL;
  if (envUrl?.includes("/restapis/")) {
    const parts = envUrl.split("/local/_user_request_");
    return parts[0] + "/local/_user_request_";
  }
  if (process.env.API_ID) return `http://localhost:4566/restapis/${process.env.API_ID}/local/_user_request_`;

  try {
    const apiId = execSync(
      `docker exec costscrunch-localstack /usr/local/bin/aws --endpoint-url=http://localhost:4566 --region us-east-1 apigateway get-rest-apis --query "items[?name=='costscrunch-dev-api'].id | [0]" --output text 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim().replace(/\r/g, "");
    if (apiId && apiId !== "None") return `http://localhost:4566/restapis/${apiId}/local/_user_request_`;
  } catch {}
  throw new Error("Cannot resolve LocalStack API ID.");
};

const BASE_URL = getBaseUrl();
const AUTH_HEADERS = { Authorization: "Bearer mock", "x-mock-user-id": "test-user-http" };

describe("Expenses HTTP Integration", () => {
  it("can create an expense and export it", async () => {
    // 1. Create an expense
    const createRes = await axios.post(`${BASE_URL}/expenses`, {
      merchant: "Export Test",
      amount: 50,
      currency: "USD",
      date: "2026-03-31",
      category: "Food"
    }, { headers: AUTH_HEADERS });
    expect(createRes.status).toBe(201);

    // 2. Export expenses
    const exportRes = await axios.get(`${BASE_URL}/expenses/export`, {
      params: { format: "json" },
      headers: AUTH_HEADERS
    });
    
    expect(exportRes.status).toBe(200);
    const items = exportRes.data;
    expect(Array.isArray(items)).toBe(true);
    expect(items.some((e: any) => e.merchant === "Export Test")).toBe(true);
  });

  it("handles 404 for non-existent expense", async () => {
    try {
      await axios.get(`${BASE_URL}/expenses/non-existent-id`, { headers: AUTH_HEADERS });
    } catch (e: any) {
      expect(e.response.status).toBe(404);
    }
  });
});
