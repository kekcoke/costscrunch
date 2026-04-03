import axios from "axios";
import { execSync } from "child_process";
import { ulid } from "ulid";
import { describe, it, expect, afterAll } from "vitest";

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
const AUTH_HEADERS = { Authorization: "Bearer mock", "x-mock-user-id": "user-owner" };

describe("Groups & Settlements Integration", () => {
  it("full group settlement lifecycle", async () => {
    const gid_name = `IntegTest-${ulid().slice(-6)}`;
    
    // 1. Create Group
    const createRes = await axios.post(`${BASE_URL}/groups`, { name: gid_name }, { headers: AUTH_HEADERS });
    const gid = createRes.data.groupId;
    expect(createRes.status).toBe(201);

    // 2. Add Expense to Group
    const expRes = await axios.post(`${BASE_URL}/expenses`, {
      merchant: "Dinner", amount: 100, currency: "USD", date: "2026-03-31", category: "Meals", groupId: gid
    }, { headers: AUTH_HEADERS });
    const eid = expRes.data.expenseId;
    expect(expRes.status).toBe(201);

    // 3. Approve Expense
    await axios.patch(`${BASE_URL}/expenses/${eid}`, { status: "approved" }, { headers: AUTH_HEADERS });

    // 4. Settle Balances
    try {
      const settleRes = await axios.post(`${BASE_URL}/groups/${gid}/settle`, {}, { headers: AUTH_HEADERS });
      expect(settleRes.status).toBe(200);
    } catch (e: any) {
      if (e.response) {
        console.error("Settle failed with:", e.response.status, e.response.data);
      }
      throw e;
    }

    // 5. Verify Settlement in DDB
    const verifyRes = await axios.get(`${BASE_URL}/expenses/${eid}`, { headers: AUTH_HEADERS });
    expect(verifyRes.data.status).toBe("reimbursed");

    // 6. Cleanup
    console.log(`[TEST] DELETE URL: ${BASE_URL}/groups/${gid}`);
    try {
      const delRes = await axios.delete(`${BASE_URL}/groups/${gid}`, { headers: AUTH_HEADERS });
      console.log(`[TEST] Delete success: ${delRes.status}`);
    } catch (e: any) {
      if (e.response) {
        console.error(`[TEST] Delete failed: ${e.response.status}`, JSON.stringify(e.response.data));
      } else {
        console.error(`[TEST] Delete error:`, e.message);
      }
      throw e;
    }
  });
});
