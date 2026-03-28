import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostConfirmationConfirmSignUpTriggerEvent } from "aws-lambda";

// vi.hoisted runs before vi.mock hoisting — mockSend must be vi.fn()
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/utils/awsClients.js", () => ({
  createDynamoDBDocClient: () => ({ send: mockSend }),
}));

vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: class {
    info = vi.fn();
    error = vi.fn();
  },
}));

import { handler } from "../../src/lambdas/auth-trigger/post-confirmation.js";

describe("auth-trigger post-confirmation handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  const makeEvent = (
    overrides: Partial<PostConfirmationConfirmSignUpTriggerEvent> = {},
  ): PostConfirmationConfirmSignUpTriggerEvent =>
    ({
      version: "1",
      triggerSource: "PostConfirmation_ConfirmSignUp",
      region: "us-east-1",
      userPool: { id: "us-east-1_pool", name: "test-pool" },
      userName: "test-user-001",
      callerContext: { awsSdkVersion: "1", clientId: "client-id" },
      request: {
        userAttributes: {
          sub: "00000000-0000-0000-0000-test-user-001",
          email: "alice@costscrunch.dev",
          name: "Alice",
        },
        clientMetadata: {},
      },
      response: {},
      ...overrides,
    }) as any;

  const putInput = () => {
    const call = mockSend.mock.calls[0];
    return call?.[0]?.input as any;
  };

  it("writes USER#<sub> + PROFILE#<sub> to DynamoDB", async () => {
    await handler(makeEvent());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = putInput();
    expect(input.TableName).toBeDefined();
    expect(input.Item.pk).toBe("USER#00000000-0000-0000-0000-test-user-001");
    expect(input.Item.sk).toBe("PROFILE#00000000-0000-0000-0000-test-user-001");
  });

  it("populates all required profile fields", async () => {
    await handler(makeEvent());

    const item = putInput()?.Item;
    expect(item.entityType).toBe("USER");
    expect(item.userId).toBe("00000000-0000-0000-0000-test-user-001");
    expect(item.email).toBe("alice@costscrunch.dev");
    expect(item.name).toBe("Alice");
    expect(item.plan).toBe("free");
    expect(item.currency).toBe("USD");
    expect(item.timezone).toBe("UTC");
    expect(item.locale).toBe("en-US");
    expect(item.notificationPreferences).toEqual({
      email: true, push: true, sms: false, digestFrequency: "weekly",
    });
    expect(item.createdAt).toBeDefined();
    expect(item.updatedAt).toBeDefined();
    expect(item.lastActiveAt).toBeDefined();
  });

  it("uses email prefix as fallback name when name attribute is missing", async () => {
    const event = makeEvent();
    event.request.userAttributes = { sub: "s1", email: "bob@example.com" } as any;
    await handler(event);

    const item = putInput()?.Item;
    expect(item.name).toBe("bob");
  });

  it("returns event unchanged on success", async () => {
    const event = makeEvent();
    const result = await handler(event);
    expect(result).toBe(event);
  });

  it("skips creation if profile already exists (ConditionalCheckFailedException)", async () => {
    const err = new Error("conditional check failed");
    (err as any).name = "ConditionalCheckFailedException";
    mockSend.mockRejectedValueOnce(err);

    const event = makeEvent();
    await expect(handler(event)).resolves.toBe(event);
  });

  it("re-throws non-conditional-check errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("DynamoDB timeout"));

    const event = makeEvent();
    await expect(handler(event)).rejects.toThrow("DynamoDB timeout");
  });

  it("sets ConditionExpression to prevent overwrites", async () => {
    await handler(makeEvent());
    expect(putInput()?.ConditionExpression).toBe("attribute_not_exists(pk)");
  });

  it("maps gsi1pk to EMAIL#<email> for email lookup", async () => {
    await handler(makeEvent());
    const item = putInput()?.Item;
    expect(item.gsi1pk).toBe("EMAIL#alice@costscrunch.dev");
    expect(item.gsi1sk).toBe("USER#00000000-0000-0000-0000-test-user-001");
  });
});
