/**
 * auth.integration.test.ts
 * 
 * Full Integration Test for Authentication Flow:
 * 1. POST /auth/register -> Cognito signUp
 * 2. POST /auth/confirm  -> Cognito confirmSignUp
 * 3. POST /auth/login    -> Cognito initiateAuth (USER_PASSWORD_AUTH)
 * 4. Profile validation  -> Verify DDB record created by post-confirmation trigger
 * 
 * Uses:
 * - LocalStack (DynamoDB)
 * - cognito-local (Cognito Emulator)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { 
  CognitoIdentityProviderClient, 
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  ListUsersCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

// Import the handler for direct invocation
import { handler } from "../../src/lambdas/auth/index.js";
import { handler as triggerHandler } from "../../src/lambdas/auth-trigger/post-confirmation.js";
import { createDynamoDBDocClient } from "../../src/utils/awsClients.js";

// Config from env (set in vitest.setup.integration.ts or manually)
const USER_POOL_ID = process.env.USER_POOL_ID || "local_pool_1";
const CLIENT_ID = process.env.USER_POOL_CLIENT_ID || "local_client_1";
const COGNITO_ENDPOINT = process.env.COGNITO_ENDPOINT || "http://localhost:9229";
const TABLE_NAME = process.env.TABLE_NAME_MAIN || "costscrunch-dev-main";

const cognito = new CognitoIdentityProviderClient({
  endpoint: COGNITO_ENDPOINT,
  region: "us-east-1",
  credentials: { accessKeyId: "test", secretAccessKey: "test" }
});

const ddb = createDynamoDBDocClient();

describe("Auth Integration (End-to-End)", () => {
  const testEmail = `test-${randomUUID()}@costscrunch.dev`;
  const testPassword = "Password123!";
  const testName = "Integration Test User";
  let userSub: string;

  const makeEvent = (route: string, body: any) => ({
    routeKey: route,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    requestContext: {
      http: {
        method: route.split(" ")[0],
        path: route.split(" ")[1]
      }
    }
  });

  afterAll(async () => {
    // Cleanup Cognito User
    try {
      await cognito.send(new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: testEmail
      }));
    } catch (e) {
      // Ignore if user wasn't created
    }
  });

  it("Phase 4.1: Register a new user", async () => {
    const res = await handler(makeEvent("POST /auth/register", {
      email: testEmail,
      password: testPassword,
      name: testName
    }));

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.email).toBe(testEmail);
    expect(body.userSub).toBeDefined();
    userSub = body.userSub;
  });

  it("Phase 4.2: Confirm the user", async () => {
    // In cognito-local, we can admin-confirm to bypass email codes
    await cognito.send(new AdminConfirmSignUpCommand({
      UserPoolId: USER_POOL_ID,
      Username: testEmail
    }));

    // Verify status via SDK
    const list = await cognito.send(new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Filter: `email = "${testEmail}"`
    }));
    expect(list.Users?.[0].UserStatus).toBe("CONFIRMED");
  });

  it("Phase 4.3: Simulate Post-Confirmation Trigger", async () => {
    /**
     * NOTE: cognito-local does NOT automatically invoke Lambda triggers.
     * We must invoke the trigger handler manually to simulate the event.
     */
    const triggerEvent = {
      version: "1",
      triggerSource: "PostConfirmation_ConfirmSignUp",
      region: "us-east-1",
      userPool: { id: USER_POOL_ID, name: "local-pool" },
      userName: userSub,
      callerContext: { awsSdkVersion: "1", clientId: CLIENT_ID },
      request: {
        userAttributes: {
          sub: userSub,
          email: testEmail,
          name: testName
        },
        clientMetadata: {}
      },
      response: {}
    } as any;

    await triggerHandler(triggerEvent);

    // Verify DDB Profile Record
    const profile = await ddb.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        pk: `USER#${userSub}`,
        sk: `PROFILE#${userSub}`
      }
    }));

    expect(profile.Item).toBeDefined();
    expect(profile.Item?.email).toBe(testEmail);
    expect(profile.Item?.entityType).toBe("USER");
    expect(profile.Item?.plan).toBe("free");
  });

  it("Phase 4.4: Login and receive tokens", async () => {
    const res = await handler(makeEvent("POST /auth/login", {
      email: testEmail,
      password: testPassword
    }));

    expect(res.statusCode).toBe(200);
    const tokens = JSON.parse(res.body);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.idToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
  });
});
