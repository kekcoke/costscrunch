/**
 * groups.integration.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Integration tests for /groups API running against LocalStack.
 * Tests the full chain: API Gateway -> Lambda -> DynamoDB.
 */

import axios from "axios";
import { ulid } from "ulid";

// Construction of the REST API URL. LocalStack REST v1 requires the /restapis/ ID prefix.
const getBaseUrl = () => {
  const envUrl = process.env.VITE_API_URL || "";
  if (envUrl.includes("/restapis/")) return envUrl;
  
  // Resolve from API_ID environment variable (passed during test run)
  const apiId = process.env.API_ID;
  if (!apiId) {
    throw new Error("VITE_API_URL or API_ID environment variable must be set for integration tests.");
  }
  return `http://localhost:4566/restapis/${apiId}/local/_user_request_`;
};

const API_URL = getBaseUrl();

describe("Groups API Integration", () => {
  let createdGroupId: string;
  // The local-user-uuid-123 is the simulated sub in server.ts lambdaAdapter
  const TEST_USER_ID = "local-user-uuid-123";
  const testGroupName = `Integration Test Group ${ulid()}`;

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
  });

  // 2. GET /groups
  it("should list groups (including the new one)", async () => {
    const res = await axios.get(`${API_URL}/groups`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.items)).toBe(true);
    
    // Check if our created group is in the memberships (as a GROUP_MEMBER record)
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

    // Verify member count updated in group profile
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
