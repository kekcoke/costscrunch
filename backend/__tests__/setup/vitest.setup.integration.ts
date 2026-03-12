/**
 * vitest.setup.integration.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs before every integration test suite.
 * Sets environment variables that the Lambda handlers read at module load time.
 */
import "aws-sdk-client-mock-vitest/extend";
import { vi } from "vitest";