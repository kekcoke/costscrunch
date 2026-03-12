/**
 * vitest.setup.unit.ts
 * Sets env vars for unit tests (no LocalStack needed — SDK is mocked).
 */
import "aws-sdk-client-mock-vitest/extend";
import { vi } from "vitest";