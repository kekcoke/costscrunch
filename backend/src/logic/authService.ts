/**
 * Auth Service Layer
 *
 * Wraps Cognito Identity Provider SDK calls for sign-up, confirm,
 * sign-in, and token refresh. Provides a clean interface for Lambda
 * handlers without leaking SDK details.
 */

import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
  RespondToAuthChallengeCommand,
  AdminDisableUserCommand,
  type SignUpCommandInput,
  type ConfirmSignUpCommandInput,
  type InitiateAuthCommandInput,
  type ForgotPasswordCommandInput,
  type ConfirmForgotPasswordCommandInput,
  type RespondToAuthChallengeCommandInput,
} from "@aws-sdk/client-cognito-identity-provider";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBDocClient } from "../utils/awsClients.js";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "auth-service" });

const getPoolConfig = () => ({
  UserPoolId: process.env.USER_POOL_ID!,
  ClientId: process.env.USER_POOL_CLIENT_ID!,
});

/** Override endpoint for local cognito-local emulator */
function createCognitoClient(): CognitoIdentityProviderClient {
  const endpoint = process.env.COGNITO_ENDPOINT;
  return new CognitoIdentityProviderClient(
    endpoint
      ? { endpoint, region: process.env.AWS_REGION ?? "us-east-1" }
      : { region: process.env.AWS_REGION ?? "us-east-1" },
  );
}

const cognito = createCognitoClient();
const ddb = createDynamoDBDocClient();
const TABLE = process.env.TABLE_NAME_MAIN!;

// ─── Sign Up ──────────────────────────────────────────────────────────────────

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
}

export interface SignUpResult {
  userSub: string;
  email: string;
  codeDeliveryMedium?: string;
}

export async function signUpUser(input: SignUpInput): Promise<SignUpResult> {
  const { ClientId } = getPoolConfig();
  const params: SignUpCommandInput = {
    ClientId,
    Username: input.email,
    Password: input.password,
    UserAttributes: [
      { Name: "email", Value: input.email },
      { Name: "name", Value: input.name },
    ],
  };

  try {
    const result = await cognito.send(new SignUpCommand(params));
    logger.info("User signed up", { email: input.email, sub: result.UserSub });
    return {
      userSub: result.UserSub!,
      email: input.email,
      codeDeliveryMedium: result.CodeDeliveryDetails?.DeliveryMedium,
    };
  } catch (error: any) {
    if (error.name === "UsernameExistsException" || error.name === "AliasExistsException") {
      throw new AuthError("Email already registered", 409, error.name);
    }
    if (error.name === "InvalidPasswordException") {
      throw new AuthError("Password does not meet requirements", 400, error.name);
    }
    logger.error("SignUp failed", { error, email: input.email });
    throw error;
  }
}

// ─── Confirm Sign Up ──────────────────────────────────────────────────────────

export async function confirmUserSignUp(email: string, code: string): Promise<void> {
  const { ClientId } = getPoolConfig();
  const params: ConfirmSignUpCommandInput = {
    ClientId,
    Username: email,
    ConfirmationCode: code,
  };

  try {
    await cognito.send(new ConfirmSignUpCommand(params));
    logger.info("User confirmed", { email });
  } catch (error: any) {
    if (error.name === "CodeMismatchException") {
      throw new AuthError("Invalid confirmation code", 400, error.name);
    }
    if (error.name === "ExpiredCodeException" || error.name === "CodeDeliveryFailureException") {
      throw new AuthError("Confirmation code expired or delivery failed", 400, error.name);
    }
    logger.error("ConfirmSignUp failed", { error, email });
    throw error;
  }
}

// ─── Sign In ──────────────────────────────────────────────────────────────────

export interface SignInInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export async function signInUser(input: SignInInput): Promise<AuthTokens> {
  const { ClientId } = getPoolConfig();
  const params: InitiateAuthCommandInput = {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId,
    AuthParameters: {
      USERNAME: input.email,
      PASSWORD: input.password,
    },
  };

  try {
    const result = await cognito.send(new InitiateAuthCommand(params));
    const auth = result.AuthenticationResult;

    if (!auth?.AccessToken) {
      throw new AuthError("Authentication challenge not supported", 400, "ChallengePending");
    }

    logger.info("User signed in", { email: input.email });
    
    return {
      accessToken: auth.AccessToken,
      idToken: auth.IdToken!,
      refreshToken: auth.RefreshToken!,
      expiresIn: auth.ExpiresIn!,
      tokenType: auth.TokenType ?? "Bearer",
    };

  } catch (error: any) {
    
    if (error.name === "NotAuthorizedException") {
      throw new AuthError("Invalid credentials", 401, error.name);
    }
    
    if (error.name === "UserNotConfirmedException") {
      throw new AuthError("User is not confirmed", 403, error.name);
    }
    
    if (error.name === "UserNotFoundException") {
      throw new AuthError("Invalid credentials", 401, error.name);
    }
    
    if (error instanceof AuthError) throw error;
    
    logger.error("SignIn failed", { error, email: input.email });
    throw error;
  }
}

// ─── Refresh Token ────────────────────────────────────────────────────────────

export async function refreshAuth(refreshToken: string): Promise<Omit<AuthTokens, "refreshToken">> {
  const { ClientId } = getPoolConfig();
  const params: InitiateAuthCommandInput = {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  };

  try {
    const result = await cognito.send(new InitiateAuthCommand(params));
    const auth = result.AuthenticationResult;
    if (!auth?.AccessToken) {
      throw new AuthError("Refresh failed", 401, "RefreshFailed");
    }
    return {
      accessToken: auth.AccessToken,
      idToken: auth.IdToken!,
      expiresIn: auth.ExpiresIn!,
      tokenType: auth.TokenType ?? "Bearer",
    };
  } catch (error: any) {
    if (error.name === "NotAuthorizedException") {
      throw new AuthError("Refresh token expired", 401, error.name);
    }
    logger.error("Refresh failed", { error });
    throw error;
  }
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  const { ClientId } = getPoolConfig();
  const params: ForgotPasswordCommandInput = {
    ClientId,
    Username: email,
  };

  try {
    await cognito.send(new ForgotPasswordCommand(params));
    logger.info("Password reset requested", { email });
  } catch (error: any) {
    if (error.name === "UserNotFoundException") {
      // Don't leak user existence; return success
      logger.info("Password reset requested for non-existent user", { email });
      return;
    }
    logger.error("ForgotPassword failed", { error, email });
    throw error;
  }
}

export async function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  const { ClientId } = getPoolConfig();
  const params: ConfirmForgotPasswordCommandInput = {
    ClientId,
    Username: email,
    ConfirmationCode: code,
    Password: newPassword,
  };

  try {
    await cognito.send(new ConfirmForgotPasswordCommand(params));
    logger.info("Password reset confirmed", { email });
  } catch (error: any) {
    if (error.name === "CodeMismatchException") {
      throw new AuthError("Invalid confirmation code", 400, error.name);
    }
    if (error.name === "ExpiredCodeException") {
      throw new AuthError("Confirmation code expired", 400, error.name);
    }
    logger.error("ConfirmForgotPassword failed", { error, email });
    throw error;
  }
}

// ─── MFA ──────────────────────────────────────────────────────────────────────

export async function confirmMfa(email: string, code: string, session: string): Promise<AuthTokens> {
  const { ClientId } = getPoolConfig();
  const params: RespondToAuthChallengeCommandInput = {
    ChallengeName: "SOFTWARE_TOKEN_MFA",
    ClientId,
    ChallengeResponses: {
      USERNAME: email,
      SOFTWARE_TOKEN_MFA_CODE: code,
    },
    Session: session,
  };

  try {
    const result = await cognito.send(new RespondToAuthChallengeCommand(params));
    const auth = result.AuthenticationResult;
    if (!auth?.AccessToken) {
      throw new AuthError("MFA verification failed", 401, "MfaFailed");
    }
    return {
      accessToken: auth.AccessToken,
      idToken: auth.IdToken!,
      refreshToken: auth.RefreshToken!,
      expiresIn: auth.ExpiresIn!,
      tokenType: auth.TokenType ?? "Bearer",
    };
  } catch (error: any) {
    if (error.name === "CodeMismatchException") {
      throw new AuthError("Invalid MFA code", 400, error.name);
    }
    if (error.name === "ExpiredCodeException") {
      throw new AuthError("MFA code expired", 400, error.name);
    }
    if (error instanceof AuthError) throw error;
    logger.error("MFA verification failed", { error, email });
    throw error;
  }
}

// ─── Account Management ───────────────────────────────────────────────────────

/**
 * Soft-deletes a user account.
 * 1. Updates DynamoDB profile status to ARCHIVED.
 * 2. Disables the user in Cognito to prevent further logins.
 */
export async function deleteAccount(userId: string, email: string): Promise<void> {
  const { UserPoolId } = getPoolConfig();
  const now = new Date().toISOString();

  try {
    // 1. Soft-delete in DynamoDB
    await ddb.send(new UpdateCommand({
      TableName: TABLE,
      Key: {
        pk: `USER#${userId}`,
        sk: `PROFILE#${userId}`,
      },
      UpdateExpression: "SET #status = :status, updatedAt = :now, deletedAt = :now",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": "ARCHIVED",
        ":now": now,
      },
      // Ensure the user exists and isn't already archived
      ConditionExpression: "attribute_exists(pk) AND #status <> :status",
    }));

    // 2. Disable in Cognito
    await cognito.send(new AdminDisableUserCommand({
      UserPoolId,
      Username: email,
    }));

    logger.info("Account soft-deleted and disabled", { userId, email });
  } catch (error: any) {
    if (error.name === "ConditionalCheckFailedException") {
      throw new AuthError("Account already deleted or not found", 404, "AccountNotFound");
    }
    logger.error("DeleteAccount failed", { error, userId });
    throw error;
  }
}

// ─── Auth Error ───────────────────────────────────────────────────────────────

export class AuthError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
