import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      // Mirrors jest.config.ts moduleNameMapper entries
      "@shared": resolve(__dirname, "src/shared"),
      "@helpers": resolve(__dirname, "__tests__/__helpers__"),
    },
  },

  test: {
    // NodeNext ESM — replaces ts-jest + extensionsToTreatAsEsm
    environment: "node",

    // Equivalent to jest testTimeout: 20000
    testTimeout: 20000,

    // Equivalent to jest maxWorkers: 1
    maxWorkers: 1,

    // Register apis globally
    globals: true,

    // --- Unit project ---
    // Run vitest with --project=unit or --project=integration to isolate suites.
    // Each project gets its own name, include glob, and setupFiles — mirroring
    // jest's "projects" array without requiring workspace InlineConfig.
    projects: [
      {
        test: {
          name: "unit",
          globals: true,
          include: ["**/__tests__/unit/**/*.test.ts"],
          setupFiles: ["__tests__/vitest.setup.unit.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          globals: true,
          include: ["**/__tests__/integration/**/*.test.ts"],
          setupFiles: ["__tests__/vitest.setup.integration.ts"],
          environment: "node",
        },
      },
    ],

    // --- Coverage (replaces collectCoverageFrom + coverageThreshold) ---
    coverage: {
      provider: "v8",
      include: [
        "src/lambdas/**/*.ts",
        "src/shared/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
      ],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },
  },
})