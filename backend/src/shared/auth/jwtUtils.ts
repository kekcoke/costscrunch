/**
 * JWT Utilities
 *
 * Lightweight JWT parsing for extracting claims from Cognito tokens.
 * Signature verification is handled by API Gateway (production) or
 * skipped in test/local environments.
 */

export interface JwtClaims {
  sub: string;
  email?: string;
  name?: string;
  "cognito:groups"?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
  token_use?: string;
  [key: string]: unknown;
}

/**
 * Decode and extract claims from a JWT without verifying the signature.
 * In production, signature verification is handled by API Gateway's
 * JWT authorizer. This utility is for extracting claims post-verification.
 */
export function extractClaims(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as JwtClaims;
  } catch {
    throw new Error("Invalid JWT format");
  }
}

/**
 * Extract Cognito groups from JWT claims.
 * Groups may come as a space-separated string or comma-separated.
 */
export function extractGroups(claims: JwtClaims): string[] {
  const groups = claims["cognito:groups"];
  if (!groups) return [];
  if (Array.isArray(groups)) return groups;
  return String(groups).split(",").filter(Boolean);
}

/**
 * Check if a JWT token has expired based on the `exp` claim.
 */
export function isTokenExpired(claims: JwtClaims): boolean {
  if (!claims.exp) return false;
  return Date.now() >= claims.exp * 1000;
}
