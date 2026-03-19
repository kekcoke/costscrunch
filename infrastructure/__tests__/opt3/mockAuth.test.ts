// ─── Option 3 Unit Tests — withMockAuth wrapper ───────────────────────────
import { describe, it, expect, vi, beforeEach } from "vitest";

// Import from backend source via alias
import { withMockAuth } from "@lambdas/_local/mockAuth";

describe("withMockAuth", () => {
  const originalMockAuth = process.env.MOCK_AUTH;

  beforeEach(() => {
    process.env.MOCK_AUTH = "true";
  });

  afterAll(() => {
    process.env.MOCK_AUTH = originalMockAuth;
  });

  it("should inject fake authorizer claims when MOCK_AUTH=true and no claims exist", async () => {
    const handler = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withMockAuth(handler);

    const event: any = { requestContext: {} };
    const context: any = {};

    await wrapped(event, context);

    expect(handler).toHaveBeenCalledOnce();
    const calledEvent = handler.mock.calls[0][0];
    expect(calledEvent.requestContext.authorizer.jwt.claims.sub).toBe(
      "00000000-0000-0000-0000-test-user-001"
    );
    expect(calledEvent.requestContext.authorizer.jwt.claims.email).toBe(
      "test@costscrunch.dev"
    );
    expect(calledEvent.requestContext.authorizer.jwt.claims["cognito:groups"]).toBe("pro");
  });

  it("should not overwrite existing claims", async () => {
    const handler = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withMockAuth(handler);

    const existingClaims = { sub: "real-user-123", email: "real@test.com", "cognito:groups": "admin" };
    const event: any = {
      requestContext: {
        authorizer: { jwt: { claims: existingClaims } },
      },
    };
    const context: any = {};

    await wrapped(event, context);

    const calledEvent = handler.mock.calls[0][0];
    expect(calledEvent.requestContext.authorizer.jwt.claims.sub).toBe("real-user-123");
    expect(calledEvent.requestContext.authorizer.jwt.claims.email).toBe("real@test.com");
  });

  it("should preserve other requestContext properties", async () => {
    const handler = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withMockAuth(handler);

    const event: any = {
      requestContext: {
        requestId: "req-123",
        http: { method: "GET", path: "/groups" },
      },
    };
    const context: any = {};

    await wrapped(event, context);

    const calledEvent = handler.mock.calls[0][0];
    expect(calledEvent.requestContext.requestId).toBe("req-123");
    expect(calledEvent.requestContext.http.method).toBe("GET");
  });

  it("should not inject claims when MOCK_AUTH is not 'true'", async () => {
    process.env.MOCK_AUTH = "false";
    const handler = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withMockAuth(handler);

    const event: any = { requestContext: {} };
    await wrapped(event, {});

    const calledEvent = handler.mock.calls[0][0];
    expect(calledEvent.requestContext.authorizer).toBeUndefined();
  });

  it("should use MOCK_USER_SUB env var when set", async () => {
    process.env.MOCK_USER_SUB = "custom-sub-999";
    const handler = vi.fn().mockResolvedValue({ statusCode: 200 });
    const wrapped = withMockAuth(handler);

    await wrapped({ requestContext: {} }, {});

    const calledEvent = handler.mock.calls[0][0];
    expect(calledEvent.requestContext.authorizer.jwt.claims.sub).toBe("custom-sub-999");
    delete process.env.MOCK_USER_SUB;
  });

  it("should pass through handler return value", async () => {
    const response = { statusCode: 201, body: '{"id":"g1"}' };
    const handler = vi.fn().mockResolvedValue(response);
    const wrapped = withMockAuth(handler);

    const result = await wrapped({ requestContext: {} }, {});
    expect(result).toEqual(response);
  });

  it("should propagate handler errors", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("DynamoDB error"));
    const wrapped = withMockAuth(handler);

    await expect(wrapped({ requestContext: {} }, {})).rejects.toThrow("DynamoDB error");
  });
});
