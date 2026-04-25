/**
 * Auth Lambda Handler
 *
 * Routes: 
 * POST /auth/register, 
 * POST /auth/confirm,
 * POST /auth/login,
 * POST /auth/refresh,
 * POST /auth/forgot-password, 
 * POST /auth/confirm-password,
 * POST /auth/confirm-mfa,
 * POST /auth/logout,
 * DELETE /auth/account
 */

import { Logger } from "@aws-lambda-powertools/logger";
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
} from "../../logic/authService.js";

const logger = new Logger({ serviceName: "auth-handler" });

interface LambdaEvent {
  routeKey?: string;
  httpMethod?: string;
  path?: string;
  body?: string;
  requestContext?: {
    http?: { method: string; path: string };
  };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function parseBody(event: LambdaEvent): Record<string, any> {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

function success(statusCode: number, data: Record<string, any>): LambdaResponse {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(data) };
}

function error(statusCode: number, message: string): LambdaResponse {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify({ message }) };
}

function getRoute(event: LambdaEvent): string {
  if (event.routeKey) return event.routeKey;
  const method = event.httpMethod || event.requestContext?.http?.method || "GET";
  const path = event.path || event.requestContext?.http?.path || "/";
  return `${method} ${path}`;
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const route = getRoute(event);
  logger.info("Auth request", { route });

  try {
    switch (route) {
      case "POST /auth/register": {
        const body = parseBody(event);
        if (!body.email || !body.password || !body.name) {
          return error(400, "Missing required fields: email, password, name");
        }
        if (body.password.length < 8) {
          return error(400, "Password must be at least 8 characters");
        }
        const result = await signUpUser({
          email: body.email,
          password: body.password,
          name: body.name,
        });
        return success(201, {
          message: "Sign-up successful. Check email for confirmation code.",
          email: result.email,
          userSub: result.userSub,
        });
      }

      case "POST /auth/confirm": {
        const body = parseBody(event);
        if (!body.email || !body.code) {
          return error(400, "Missing required fields: email, code");
        }
        await confirmUserSignUp(body.email, body.code);
        return success(200, { message: "User confirmed successfully" });
      }

      case "POST /auth/login": {
        const body = parseBody(event);
        if (!body.email || !body.password) {
          return error(400, "Missing required fields: email, password");
        }
        const tokens = await signInUser({
          email: body.email,
          password: body.password,
        });
        return success(200, tokens);
      }

      case "POST /auth/refresh": {
        const body = parseBody(event);
        if (!body.refreshToken) {
          return error(400, "Missing required field: refreshToken");
        }
        const tokens = await refreshAuth(body.refreshToken);
        return success(200, tokens);
      }

      case "POST /auth/forgot-password": {
        const body = parseBody(event);
        if (!body.email) {
          return error(400, "Missing required field: email");
        }
        await forgotPassword(body.email);
        return success(200, { message: "Password reset code sent" });
      }

      case "POST /auth/confirm-password": {
        const body = parseBody(event);
        if (!body.email || !body.code || !body.password) {
          return error(400, "Missing required fields: email, code, password");
        }
        await confirmPasswordReset(body.email, body.code, body.password);
        return success(200, { message: "Password reset successful" });
      }

      case "POST /auth/confirm-mfa": {
        const body = parseBody(event);
        if (!body.email || !body.code || !body.session) {
          return error(400, "Missing required fields: email, code, session");
        }
        const tokens = await confirmMfa(body.email, body.code, body.session);
        return success(200, tokens);
      }

      case "DELETE /auth/account": {
        // Authenticated route - userId and email should come from authorizer context
        // In local development or manual test events, we can fallback to body for convenience
        const body = parseBody(event);
        const context = (event as any).requestContext?.authorizer?.jwt?.claims;
        
        const userId = context?.sub || body.userId;
        const email = context?.email || body.email;

        if (!userId || !email) {
          return error(400, "Missing identity context: userId or email");
        }

        await deleteAccount(userId, email);
        return success(200, { message: "Account archived successfully" });
      }

      case "POST /auth/logout": {
        const context = (event as any).requestContext?.authorizer?.jwt?.claims;
        const email = context?.email;
        if (!email) return error(401, "Unauthorized");

        await logoutUser(email);
        return success(200, { message: "Logged out successfully" });
      }

      case "POST /auth/claim-data": {
        const body = parseBody(event);
        const { sessionId } = body;
        const context = (event as any).requestContext?.authorizer?.jwt?.claims;
        const userId = context?.sub;

        if (!sessionId || !userId) {
          return error(400, "Missing sessionId or identity context");
        }

        const count = await claimGuestData(sessionId, userId);
        return success(200, { message: `Claimed ${count} items`, count });
      }

      default:
        return error(404, `Route not found: ${route}`);
    }
  } catch (err: any) {
    if (err instanceof AuthError) {
      return error(err.statusCode, err.message);
    }
    logger.error("Unhandled auth error", { error: err });
    // In test environments, reveal the error message for easier troubleshooting
    const msg = process.env.VITEST ? `Internal error: ${err.message}` : "Internal server error";
    return error(500, msg);
  }
}

/** Alias for integration tests that import rawHandler */
export { handler as rawHandler };
