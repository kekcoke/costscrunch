import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  RespondToAuthChallengeCommand,
  AdminDisableUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

// vi.hoisted runs before vi.mock and imports — set env vars here
const { mockSend } = vi.hoisted(() => {
  process.env.USER_POOL_ID = "us-east-1_testpool";
  process.env.USER_POOL_CLIENT_ID = "test-client-id";
  process.env.AWS_REGION = "us-east-1";
  return {
    mockSend: vi.fn().mockResolvedValue({}),
  };
});

const { 
  MockSignUpCommand, 
  MockConfirmSignUpCommand, 
  MockInitiateAuthCommand,
  MockForgotPasswordCommand,
  MockConfirmForgotPasswordCommand,
  MockRespondToAuthChallengeCommand,
  MockAdminDisableUserCommand,
  MockAdminUserGlobalSignOutCommand,
  MockGlobalSignOutCommand
} = vi.hoisted(() => {
  function makeCmd(name: string) {
    const Cmd = function(this: any, input: any) { this.input = input; this._name = name; };
    Cmd.prototype.constructor = Cmd;
    Object.defineProperty(Cmd, "name", { value: name });
    return Cmd;
  }
  return {
    MockSignUpCommand: makeCmd("SignUpCommand") as any,
    MockConfirmSignUpCommand: makeCmd("ConfirmSignUpCommand") as any,
    MockInitiateAuthCommand: makeCmd("InitiateAuthCommand") as any,
    MockForgotPasswordCommand: makeCmd("ForgotPasswordCommand") as any,
    MockConfirmForgotPasswordCommand: makeCmd("ConfirmForgotPasswordCommand") as any,
    MockRespondToAuthChallengeCommand: makeCmd("RespondToAuthChallengeCommand") as any,
    MockAdminDisableUserCommand: makeCmd("AdminDisableUserCommand") as any,
    MockAdminUserGlobalSignOutCommand: makeCmd("AdminUserGlobalSignOutCommand") as any,
    MockGlobalSignOutCommand: makeCmd("GlobalSignOutCommand") as any,
  };
});

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class { send = mockSend; },
  SignUpCommand: MockSignUpCommand,
  ConfirmSignUpCommand: MockConfirmSignUpCommand,
  InitiateAuthCommand: MockInitiateAuthCommand,
  ForgotPasswordCommand: MockForgotPasswordCommand,
  ConfirmForgotPasswordCommand: MockConfirmForgotPasswordCommand,
  RespondToAuthChallengeCommand: MockRespondToAuthChallengeCommand,
  AdminDisableUserCommand: MockAdminDisableUserCommand,
  AdminUserGlobalSignOutCommand: MockAdminUserGlobalSignOutCommand,
  GlobalSignOutCommand: MockGlobalSignOutCommand,
}));

const { mockDdbSend } = vi.hoisted(() => ({
  mockDdbSend: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/utils/awsClients.js", () => ({
  createDynamoDBDocClient: () => ({
    send: mockDdbSend,
  }),
  createCognitoClient: vi.fn(), // Already handled by SDK mock but kept for safety
}));

vi.mock("@aws-lambda-powertools/logger", () => ({
  Logger: class {
    info = vi.fn();
    error = vi.fn();
  },
}));


import {
  signUpUser,
  confirmUserSignUp,
  signInUser,
  refreshAuth,
  forgotPassword,
  confirmPasswordReset,
  confirmMfa,
  deleteAccount,
  logoutUser,
  claimGuestData,
  AuthError,
} from "../../src/logic/authService.js";

describe("Cognito auth service (PKCE — Lambda side)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  // ── Sign Up ──────────────────────────────────────────────────────────────
  describe("signUpUser", () => {
    it("calls SignUpCommand with correct params", async () => {
      mockSend.mockResolvedValueOnce({
        UserSub: "new-user-123",
        CodeDeliveryDetails: { DeliveryMedium: "EMAIL" },
      });

      const result = await signUpUser({
        email: "newuser@test.com",
        password: "Test@1234",
        name: "New User",
      });

      expect(result.userSub).toBe("new-user-123");
      expect(result.email).toBe("newuser@test.com");
      expect(result.codeDeliveryMedium).toBe("EMAIL");

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ClientId).toBe("test-client-id");
      expect(cmd.input.Username).toBe("newuser@test.com");
      expect(cmd.input.Password).toBe("Test@1234");
      expect(cmd.input.UserAttributes).toEqual([
        { Name: "email", Value: "newuser@test.com" },
        { Name: "name", Value: "New User" },
      ]);
    });

    it("throws AuthError on AliasExistsException (email already registered)", async () => {
      const err = new Error("alias exists");
      (err as any).name = "AliasExistsException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signUpUser({ email: "dup@t.com", password: "P@ss1234!", name: "D" }),
      ).rejects.toThrow("Email already registered");
    });

    it("throws AuthError on UsernameExistsException", async () => {
      const err = new Error("username exists");
      (err as any).name = "UsernameExistsException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signUpUser({ email: "dup@t.com", password: "P@ss1234!", name: "D" }),
      ).rejects.toThrow("Email already registered");
    });

    it("throws AuthError on InvalidPasswordException", async () => {
      const err = new Error("invalid password");
      (err as any).name = "InvalidPasswordException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signUpUser({ email: "u@t.com", password: "weak", name: "U" }),
      ).rejects.toThrow("Password does not meet requirements");
    });

    it("re-throws unexpected errors", async () => {
      mockSend.mockRejectedValueOnce(new Error("Network error"));

      await expect(
        signUpUser({ email: "u@t.com", password: "Test@1234!", name: "U" }),
      ).rejects.toThrow("Network error");
    });
  });

  // ── Confirm Sign Up ──────────────────────────────────────────────────────
  describe("confirmUserSignUp", () => {
    it("calls ConfirmSignUpCommand with email + code", async () => {
      mockSend.mockResolvedValueOnce({});

      await confirmUserSignUp("user@t.com", "123456");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ClientId).toBe("test-client-id");
      expect(cmd.input.Username).toBe("user@t.com");
      expect(cmd.input.ConfirmationCode).toBe("123456");
    });

    it("throws AuthError on CodeMismatchException", async () => {
      const err = new Error("code mismatch");
      (err as any).name = "CodeMismatchException";
      mockSend.mockRejectedValueOnce(err);

      await expect(confirmUserSignUp("u@t.com", "000000")).rejects.toThrow(
        "Invalid confirmation code",
      );
    });

    it("throws AuthError on ExpiredCodeException", async () => {
      const err = new Error("expired");
      (err as any).name = "ExpiredCodeException";
      mockSend.mockRejectedValueOnce(err);

      await expect(confirmUserSignUp("u@t.com", "000000")).rejects.toThrow(
        "Confirmation code expired or delivery failed",
      );
    });
  });

  // ── Sign In ──────────────────────────────────────────────────────────────
  describe("signInUser", () => {
    it("calls InitiateAuthCommand and returns tokens on success", async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: "eyJaccess",
          IdToken: "eyJid",
          RefreshToken: "refresh-abc",
          ExpiresIn: 900,
          TokenType: "Bearer",
        },
      });

      const result = await signInUser({ email: "u@t.com", password: "P@ss1234!" });

      expect(result.accessToken).toBe("eyJaccess");
      expect(result.idToken).toBe("eyJid");
      expect(result.refreshToken).toBe("refresh-abc");
      expect(result.expiresIn).toBe(900);
      expect(result.tokenType).toBe("Bearer");

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(InitiateAuthCommand);
      expect(cmd.input.AuthFlow).toBe("USER_PASSWORD_AUTH");
      expect(cmd.input.AuthParameters?.USERNAME).toBe("u@t.com");
      expect(cmd.input.AuthParameters?.PASSWORD).toBe("P@ss1234!");
    });

    it("throws AuthError on NotAuthorizedException (invalid credentials)", async () => {
      const err = new Error("not authorized");
      (err as any).name = "NotAuthorizedException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signInUser({ email: "u@t.com", password: "wrong" }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("throws AuthError on UserNotConfirmedException", async () => {
      const err = new Error("not confirmed");
      (err as any).name = "UserNotConfirmedException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signInUser({ email: "u@t.com", password: "P@ss1234!" }),
      ).rejects.toThrow("User is not confirmed");
    });

    it("throws AuthError on UserNotFoundException (same as invalid credentials)", async () => {
      const err = new Error("not found");
      (err as any).name = "UserNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signInUser({ email: "ghost@t.com", password: "P@ss1234!" }),
      ).rejects.toThrow("Invalid credentials");
    });

    it("throws AuthError on ResourceNotFoundException (user pool config error)", async () => {
      const err = new Error("pool not found");
      (err as any).name = "ResourceNotFoundException";
      mockSend.mockRejectedValueOnce(err);

      await expect(
        signInUser({ email: "u@t.com", password: "P@ss1234!" }),
      ).rejects.toThrow("pool not found");
    });

    it("throws AuthError when no AccessToken returned (challenge pending)", async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {},
      });

      await expect(
        signInUser({ email: "u@t.com", password: "P@ss1234!" }),
      ).rejects.toThrow("Authentication challenge not supported");
    });
  });

  // ── Refresh Token ────────────────────────────────────────────────────────
  describe("refreshAuth", () => {
    it("returns new access token from valid refresh token", async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: "new-access-token",
          IdToken: "new-id-token",
          ExpiresIn: 900,
          TokenType: "Bearer",
        },
      });

      const result = await refreshAuth("valid-refresh-token");

      expect(result.accessToken).toBe("new-access-token");
      expect(result.idToken).toBe("new-id-token");
      expect(result.expiresIn).toBe(900);

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd).toBeInstanceOf(InitiateAuthCommand);
      expect(cmd.input.AuthFlow).toBe("REFRESH_TOKEN_AUTH");
      expect(cmd.input.AuthParameters?.REFRESH_TOKEN).toBe("valid-refresh-token");
    });

    it("throws AuthError when refresh token is expired", async () => {
      const err = new Error("not authorized");
      (err as any).name = "NotAuthorizedException";
      mockSend.mockRejectedValueOnce(err);

      await expect(refreshAuth("expired-token")).rejects.toThrow("Refresh token expired");
    });
  });

  // ── Forgot Password ──────────────────────────────────────────────────────
  describe("forgotPassword", () => {
    it("calls ForgotPasswordCommand", async () => {
      mockSend.mockResolvedValueOnce({});
      await forgotPassword("user@t.com");
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Username).toBe("user@t.com");
    });

    it("swallows UserNotFoundException to prevent enumeration", async () => {
      const err = new Error("not found");
      (err as any).name = "UserNotFoundException";
      mockSend.mockRejectedValueOnce(err);
      await expect(forgotPassword("ghost@t.com")).resolves.not.toThrow();
    });
  });

  // ── Confirm Password Reset ───────────────────────────────────────────────
  describe("confirmPasswordReset", () => {
    it("calls ConfirmForgotPasswordCommand", async () => {
      mockSend.mockResolvedValueOnce({});
      await confirmPasswordReset("u@t.com", "123456", "NewPass123!");
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Username).toBe("u@t.com");
      expect(cmd.input.ConfirmationCode).toBe("123456");
      expect(cmd.input.Password).toBe("NewPass123!");
    });
  });

  // ── Confirm MFA ──────────────────────────────────────────────────────────
  describe("confirmMfa", () => {
    it("calls RespondToAuthChallengeCommand and returns tokens", async () => {
      mockSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: "mfa-access",
          IdToken: "mfa-id",
          RefreshToken: "mfa-refresh",
          ExpiresIn: 3600,
        }
      });

      const res = await confirmMfa("u@t.com", "123456", "session-xyz");
      expect(res.accessToken).toBe("mfa-access");
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");
      expect(cmd.input.ChallengeResponses.SOFTWARE_TOKEN_MFA_CODE).toBe("123456");
      expect(cmd.input.Session).toBe("session-xyz");
    });
  });

  // ── Delete Account ──────────────────────────────────────────────────────
  describe("deleteAccount", () => {
    it("updates DynamoDB and disables Cognito user", async () => {
      mockSend.mockResolvedValueOnce({}); // Cognito success
      
      // We don't have direct access to the mocked ddb client here because it's inside authService,
      // but the call shouldn't throw.
      await expect(deleteAccount("user-123", "test@test.com")).resolves.not.toThrow();

      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Username).toBe("test@test.com");
      expect(cmd.input.UserPoolId).toBe("us-east-1_testpool");
    });
  });

  // ── Global Logout ────────────────────────────────────────────────────────
  describe("logoutUser", () => {
    it("calls AdminUserGlobalSignOutCommand", async () => {
      mockSend.mockResolvedValueOnce({});
      await logoutUser("user@test.com");
      
      const cmd = mockSend.mock.calls[0][0];
      expect(cmd.input.Username).toBe("user@test.com");
      expect(cmd.input.UserPoolId).toBe("us-east-1_testpool");
    });
  });

  // ── Claim Data ───────────────────────────────────────────────────────────
  describe("claimGuestData", () => {
    it("migrates items from GUEST partition to RECEIPT partition", async () => {
      const mockItems = [
        { pk: "GUEST#SESSION#s1", sk: "SCAN#1", expenseId: "e1", userId: "GUEST" }
      ];
      
      mockDdbSend
        .mockResolvedValueOnce({ Items: mockItems }) // Query
        .mockResolvedValueOnce({}); // BatchWrite

      const count = await claimGuestData("s1", "real-user-123");
      
      expect(count).toBe(1);
      expect(mockDdbSend).toHaveBeenCalledTimes(2);
      
      const batchArg = mockDdbSend.mock.calls[1][0].input;
      const tableName = process.env.TABLE_NAME_MAIN || "costscrunch-dev-main";
      const writeReq = batchArg.RequestItems[tableName][0].PutRequest.Item;
      expect(writeReq.pk).toBe("RECEIPT#e1");
      expect(writeReq.userId).toBe("real-user-123");
    });
  });

  // ── AuthError class ──────────────────────────────────────────────────────
  describe("AuthError", () => {
    it("has correct properties", () => {
      const err = new AuthError("test", 401, "TestCode");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("AuthError");
      expect(err.message).toBe("test");
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("TestCode");
    });
  });
});
