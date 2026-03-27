/**
 * groups.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for /groups API running against LocalStack.
 */

import axios from "axios";
import { execSync } from "child_process";
import { ulid } from "ulid";

const getBaseUrl = (): string => {
  const envUrl = process.env.VITE_API_URL;
  if (envUrl?.includes("/restapis/")) return envUrl;
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

const API_URL = getBaseUrl();

describe("Groups API Integration", () => {
  let createdGroupId: string;
  const testGroupName = `IntegTest-${ulid().slice(-6)}`;
  const AUTH_HEADERS = { Authorization: "Bearer mock", "x-mock-user-id": "user-owner" };

  afterAll(async () => {
    // Flush created resources: Scan for all groups starting with 'IntegTest-' and delete them
    try {
      const res = await axios.get(`${API_URL}/groups`, { headers: AUTH_HEADERS });
      const groupsToFlush = res.data.items.filter((g: any) => 
        g.name?.startsWith("IntegTest-") || g.name?.startsWith("Delete-Me")
      );
      
      for (const group of groupsToFlush) {
        await axios.delete(`${API_URL}/groups/${group.groupId}`, { headers: AUTH_HEADERS });
        console.log(`[FLUSH] Deleted group: ${group.name} (${group.groupId})`);
      }
    } catch (err) {
      console.warn("[FLUSH] Failed to clean up integration test groups");
    }
  });

  it("should create a new group", async () => {
    const res = await axios.post(`${API_URL}/groups`, {
      name: testGroupName,
      type: "household",
      currency: "EUR"
    }, { headers: AUTH_HEADERS });
    expect(res.status).toBe(201);
    createdGroupId = res.data.groupId;
  });

  it("should successfully soft-delete a settled group", async () => {
    // We use the group created in the first test (which has no expenses)
    const delRes = await axios.delete(`${API_URL}/groups/${createdGroupId}`, { headers: AUTH_HEADERS });
    expect(delRes.status).toBe(200);
    expect(delRes.data.deleted).toBe(true);

    // Verify soft-delete status (item still exists but is inactive)
    const getRes = await axios.get(`${API_URL}/groups/${createdGroupId}`, { headers: AUTH_HEADERS });
    expect(getRes.data.active).toBe(false);
  });

  it("should fail to delete a non-existent group", async () => {
    try {
      await axios.delete(`${API_URL}/groups/invalid-${ulid()}`, { headers: AUTH_HEADERS });
      throw new Error("Should have thrown 404");
    } catch (err: any) {
      if (!err.response) throw err;
      expect(err.response.status).toBe(404);
    }
  });
});
