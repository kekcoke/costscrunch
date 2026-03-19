/**
 * groups.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for /groups API running against LocalStack.
 * Tests the full chain: API Gateway -> Lambda -> DynamoDB.
 */

import axios from "axios";
import { ulid } from "ulid";

const getBaseUrl = () => {
  const envUrl = process.env.VITE_API_URL;
  // If VITE_API_URL is a full REST API path, use it.
  if (envUrl && envUrl.includes("/restapis/")) return envUrl;
  
  // Otherwise, require API_ID and build the path.
  const apiId = process.env.API_ID;
  if (!apiId) {
    throw new Error("API_ID must be set if VITE_API_URL is not a full REST API endpoint (currently: " + envUrl + ")");
  }
  return `http://localhost:4566/restapis/${apiId}/local/_user_request_`;
};

const API_URL = getBaseUrl();
console.log(`[TEST_INFO] Targeted API URL: ${API_URL}`);

describe("Groups API Integration", () => {
  let createdGroupId: string;
  const testGroupName = `IntegTest-${ulid().slice(-6)}`; // Shorter unique name

  // Cleanup after all tests
  afterAll(async () => {
    if (createdGroupId) {
      try {
        const delRes = await axios.delete(`${API_URL}/groups/${createdGroupId}`);
        console.log(`[CLEANUP] Deleted group ${createdGroupId} (Status: ${delRes.status})`);
      } catch (err: any) {
        console.warn(`[CLEANUP] Failed to delete group ${createdGroupId}: ${err.response?.status || err.message}`);
      }
    }
  });

  // 1. POST /groups
  it("should create a new group", async () => {
    const res = await axios.post(`${API_URL}/groups`, {
      name: testGroupName,
      type: "household",
      currency: "EUR"
    });

    expect(res.status).toBe(201);
    expect(res.data.name).toBe(testGroupName);
    expect(res.data.currency).toBe("EUR");
    createdGroupId = res.data.groupId;
    expect(createdGroupId).toBeDefined();
  });

  // 2. GET /groups
  it("should list groups (including the new one)", async () => {
    const res = await axios.get(`${API_URL}/groups`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.items)).toBe(true);
    
    const hasGroup = res.data.items.some((g: any) => g.groupId === createdGroupId);
    expect(hasGroup).toBe(true);
  });

  // 3. GET /groups/:id
  it("should fetch group details", async () => {
    const res = await axios.get(`${API_URL}/groups/${createdGroupId}`);
    expect(res.status).toBe(200);
    expect(res.data.groupId).toBe(createdGroupId);
    expect(res.data.name).toBe(testGroupName);
  });

  // 4. PATCH /groups/:id
  it("should update group settings", async () => {
    const newName = `${testGroupName} - Updated`;
    const res = await axios.patch(`${API_URL}/groups/${createdGroupId}`, {
      name: newName,
      color: "#ff0000"
    });

    expect(res.status).toBe(200);
    expect(res.data.name).toBe(newName);
    expect(res.data.color).toBe("#ff0000");
  });

  // 5. POST /groups/:id/members
  it("should add a member to the group", async () => {
    const res = await axios.post(`${API_URL}/groups/${createdGroupId}/members`, {
      email: "guest@example.com",
      name: "Guest User",
      role: "member"
    });

    expect(res.status).toBe(200);
    expect(res.data.added.email).toBe("guest@example.com");

    const groupRes = await axios.get(`${API_URL}/groups/${createdGroupId}`);
    expect(groupRes.data.memberCount).toBe(2);
  });

  // 6. GET /groups/:id/balances
  it("should return balances and settlements", async () => {
    const res = await axios.get(`${API_URL}/groups/${createdGroupId}/balances`);
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("balances");
    expect(res.data).toHaveProperty("settlements");
  });
});
