/**
 * jest.config.ts  (backend root)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two projects:
 *   unit         → fast, no I/O, uses aws-sdk-client-mock
 *   integration  → requires LocalStack running on :4566
 *
 * Run unit only:        npx jest --selectProjects unit
 * Run integration only: npx jest --selectProjects integration
 * Run all:              npx jest
 */

import type { Config } from "jest";

const sharedConfig: Partial<Config> = {
  preset:          "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@shared/(.*)$": "<rootDir>/shared/$1",
    "^@helpers/(.*)$": "<rootDir>/__tests__/__helpers__/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }],
  },
};

const config: Config = {
  projects: [
    // ── Unit tests ──────────────────────────────────────────────────────────
    {
      ...sharedConfig,
      displayName:   "unit",
      testMatch:     ["**/__tests__/unit/**/*.test.ts"],
      setupFiles:    ["<rootDir>/__tests__/jest.setup.unit.ts"],
      coveragePathIgnorePatterns: ["/node_modules/", "/__tests__/"],
    },

    // ── Integration tests ───────────────────────────────────────────────────
    {
      ...sharedConfig,
      displayName:  "integration",
      testMatch:    ["**/__tests__/integration/**/*.test.ts"],
      setupFiles:   ["<rootDir>/__tests__/jest.setup.integration.ts"],
      testTimeout:  30_000,   // LocalStack can be slow to respond
      maxWorkers:   1,        // Run sequentially to avoid table conflicts
    },
  ],

  collectCoverageFrom: [
    "src/lambdas/**/*.ts",
    "src/shared/**/*.ts",
    "!**/*.d.ts",
  ],
  coverageThreshold: {
    global: { branches: 70, functions: 75, lines: 75, statements: 75 },
  },
};

export default config;