import { ApiEvent, AuthContext } from "../shared/models/types.js";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "auth-util" });

/**
 * Extracts authentication context from API Gateway event.
 * Supports both HTTP API v2 (jwt) and REST API v1 (claims) formats.
 */
export function getAuth(event: ApiEvent): AuthContext {
  const authorizer = event.requestContext?.authorizer;
  
  // Try v2 (JWT) then v1 (Standard Claims)
  const claims = authorizer?.jwt?.claims || (authorizer as any)?.claims;

  if (!claims?.sub) {
    logger.error("Unauthorized: No user sub found in claims", { 
      hasAuthorizer: !!authorizer,
      hasJwt: !!authorizer?.jwt 
    });
    throw new Error("Unauthorized: Missing user identity");
  }

  return {
    userId: claims.sub,
    email: claims.email || "",
    groups: (claims["cognito:groups"] || "").split(",").filter(Boolean),
    plan: "pro", // Default plan for local/dev
  };
}
