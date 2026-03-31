import axios from "axios";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";

const getBaseUrl = (): string => {
  const envUrl = process.env.VITE_API_URL;
  if (envUrl?.includes("/restapis/")) return envUrl.split("/groups")[0].split("/expenses")[0].split("/profile")[0];
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
const AUTH_HEADERS = { Authorization: "Bearer mock", "x-mock-user-id": "user-owner" };

describe("Profile API Integration", () => {
  it("should fetch and update user profile", async () => {
    // 1. Get initial profile
    const getRes = await axios.get(`${BASE_URL}/profile`, { headers: AUTH_HEADERS });
    expect(getRes.status).toBe(200);
    
    // 2. Update profile
    const updates = {
      name: "Updated Integration Name",
      currency: "GBP",
      timezone: "Europe/London"
    };
    const patchRes = await axios.patch(`${BASE_URL}/profile`, updates, { headers: AUTH_HEADERS });
    expect(patchRes.status).toBe(200);
    expect(patchRes.data.name).toBe(updates.name);
    expect(patchRes.data.currency).toBe(updates.currency);

    // 3. Verify persistence
    const verifyRes = await axios.get(`${BASE_URL}/profile`, { headers: AUTH_HEADERS });
    expect(verifyRes.data.name).toBe(updates.name);
  });
});
