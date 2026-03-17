/**
 * Mock auth middleware for local SAM / LocalStack development.
 *
 * When MOCK_AUTH=true, injects a fake Cognito JWT authorizer context
 * into the event before passing it to the real handler.
 * This lets handlers call getAuth(event) without a real Cognito pool.
 */
const MOCK_CLAIMS: Record<string, string> = {
  sub: process.env.MOCK_USER_SUB || "00000000-0000-0000-0000-test-user-001",
  email: process.env.MOCK_USER_EMAIL || "test@costscrunch.dev",
  "cognito:groups": process.env.MOCK_USER_GROUPS || "pro",
};

export function withMockAuth(
  handler: (event: any, context: any) => Promise<any>,
): (event: any, context: any) => Promise<any> {
  return async (event: any, context: any) => {
    if (
      process.env.MOCK_AUTH === "true" &&
      !event.requestContext?.authorizer?.jwt?.claims?.sub
    ) {
      event.requestContext = {
        ...event.requestContext,
        authorizer: {
          jwt: { claims: { ...MOCK_CLAIMS } },
        },
      };
    }
    return handler(event, context);
  };
}
