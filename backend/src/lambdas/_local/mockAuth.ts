/**
 * Mock auth middleware for local SAM / LocalStack development.
 *
 * When MOCK_AUTH=true, injects a fake Cognito JWT authorizer context
 * into the event before passing it to the real handler.
 * This lets handlers call getAuth(event) without a real Cognito pool.
 */
// Read env vars at call time so tests can override them after import
function getMockClaims(): Record<string, string> {
  return {
    sub: process.env.MOCK_USER_SUB || "00000000-0000-0000-0000-test-user-001",
    email: process.env.MOCK_USER_EMAIL || "test@costscrunch.dev",
    "cognito:groups": process.env.MOCK_USER_GROUPS || "pro",
  };
}

export function withMockAuth(
  handler: (event: any, context?: any) => Promise<any>,
): (event: any, context?: any) => Promise<any> {
  return async (event: any, context?: any) => {
    // OWASP ASVS v4.0 V13.1 — mock auth must never be active outside dev
    if (
      process.env.MOCK_AUTH === "true" &&
      process.env.ENVIRONMENT !== "dev"
    ) {
      throw new Error(
        `MOCK_AUTH is enabled in a non-dev environment (ENVIRONMENT=${process.env.ENVIRONMENT}). ` +
        "Refusing to process request. See OWASP ASVS v4.0 control V13.1.",
      );
    }

    if (process.env.MOCK_AUTH === "true") {
      const authorizer = event.requestContext?.authorizer || {};
      const claims = authorizer.jwt?.claims || authorizer.claims;

      if (!claims?.sub) {
        const mockClaims = getMockClaims();
        event.requestContext = {
          ...event.requestContext,
          authorizer: {
            ...authorizer,
            jwt: { claims: { ...mockClaims } },
            // Also inject into root for v1 compatibility
            claims: { ...mockClaims },
          },
        };
      }
    }
    return handler(event, context);
  };
}
