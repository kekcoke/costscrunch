/**
 * Auth Middleware
 *
 * Provides JWT verification and user context injection for Lambda handlers.
 * In production, API Gateway's JWT authorizer handles signature verification.
 * This middleware extracts claims and provides a consistent auth interface.
 */

import { extractClaims, isTokenExpired, type JwtClaims } from "./jwtUtils.js";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "auth-middleware" });

export interface AuthEvent {
  headers: Record<string, string | undefined>;
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims: JwtClaims;
      };
    };
  };
}

/**
 * Extract and verify JWT token from Authorization header.
 * Returns decoded claims if valid.
 */
export async function verifyToken(event: AuthEvent): Promise<JwtClaims> {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;

  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Invalid Authorization header format");
  }

  const token = authHeader.slice(7);
  const claims = extractClaims(token);

  if (isTokenExpired(claims)) {
    throw new Error("Token expired");
  }

  return claims;
}

/**
 * Extract userId (sub) from JWT claims.
 */
export function extractUserId(claims: JwtClaims): string {
  if (!claims.sub) {
    throw new Error("Missing sub claim");
  }
  return claims.sub;
}

/**
 * Higher-order function that wraps a Lambda handler with JWT authentication.
 * Injects verified claims into the event's requestContext.authorizer.jwt.
 */
export function withAuth<TEvent extends AuthEvent, TResult>(
  handler: (event: TEvent, context: any) => Promise<TResult>,
) {
  return async (event: TEvent, context: any): Promise<TResult> => {
    try {
      const claims = await verifyToken(event);

      // Inject claims into the event structure (same shape as API Gateway JWT authorizer)
      const enrichedEvent = {
        ...event,
        requestContext: {
          ...event.requestContext,
          authorizer: {
            jwt: { claims },
          },
        },
      };

      return handler(enrichedEvent as TEvent, context);
    } catch (error: any) {
      logger.error("Auth middleware rejection", { error: error.message });
      return {
        statusCode: 401,
        body: JSON.stringify({ message: error.message }),
      } as unknown as TResult;
    }
  };
}
