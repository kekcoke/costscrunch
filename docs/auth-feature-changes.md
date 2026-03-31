# Authentication Feature: Summary of Changes

This document summarizes the changes and additions implemented in the `setup/landing-login-signup-mfa-passwordreset` branch to unify the authentication flow and testing infrastructure.

## 1. Affected Files & Modifications

### Backend Core
- **`backend/src/logic/authService.ts`**:
    - Refactored to use a dynamic getter (`getPoolConfig`) for environment variables (`USER_POOL_ID`, `CLIENT_ID`) instead of top-level constants.
    - Added `deleteAccount` logic implementing DynamoDB archiving (status: `ARCHIVED`) and Cognito user disabling (`AdminDisableUserCommand`).
- **`backend/src/lambdas/auth/index.ts`**:
    - Added `DELETE /auth/account` route.
    - Updated error handling to provide descriptive error messages in Vitest environments.

### Frontend Service Layer
- **`frontend/src/services/api.ts`**:
    - Implemented `authApi` object with methods for `forgotPassword`, `confirmPassword`, `confirmMfa`, and `deleteAccount`.
    - Wired these methods to the custom backend Lambda proxy endpoints.

### Frontend Pages
- **`frontend/src/pages/mfaPage.tsx`**: Updated imports to use the centralized `authApi` from services.
- **`frontend/src/pages/passwordReset.tsx`**: Refactored to remove direct `aws-amplify` dependencies, routing all requests through the new `authApi`.
- **`frontend/src/pages/passwordResetPage.tsx`**: Updated imports to use the centralized `authApi`.

### Testing Infrastructure
- **`backend/__tests__/unit/auth-cognito.unit.test.ts`**:
    - Added 22 test cases covering full registration, login, reset, MFA, and account deletion logic.
    - Implemented mocks for DynamoDB and Cognito SDK v3 commands.
- **`backend/__tests__/integration/auth.integration.test.ts`**:
    - Implemented dynamic User Pool bootstrapping to support emulators with randomized IDs.
    - Added 9 lifecycle phases verifying the end-to-end user journey.
    - Switched to dynamic handler imports to solve Vitest module hoisting issues.

### Miscellaneous
- **`.gitignore`**: Added `.cognito/db/` to exclude transient local emulator database files.
- **`notes/2026-03-31-auth-integration-test-resolution.md`**: Created technical documentation on Vitest module lifecycle and environment injection.

## 2. Implementation Logic
The architecture shifted from a direct Amplify-to-Cognito model to a **Proxy Pattern**. All authentication requests now flow through a custom Lambda, allowing for:
1. **Server-side Validation**: Additional logic (like profile creation) during registration.
2. **Custom Soft-Delete**: Automated archiving of user data in DynamoDB when an account is deleted.
3. **Environment Agnosticism**: Seamless switching between local emulators and live AWS environments via dynamic configuration getters.
