import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@config": resolve(__dirname, "__tests__/__config__"),
      "@helpers": resolve(__dirname, "__tests__/__helpers__"),
      "@mocks": resolve(__dirname, "__tests__/__mocks__"),
    },
  },

  test: {
    environment: "node",

    // Equivalent to jest testTimeout
    testTimeout: 20000,

    // Equivalent to jest maxWorkers
    maxWorkers: 1,

    globals: true,

    // --- Test projects ---
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/__tests__/unit/**/*.test.ts"],
          globals: true,
          setupFiles: [
            resolve(__dirname, "__tests__/setup/setupTestEnv.ts"),
            resolve(__dirname, "__tests__/setup/vitest.setup.unit.ts"),
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/__tests__/integration/**/*.test.ts"],
          globals: true,
          setupFiles: [
            resolve(__dirname, "__tests__/setup/setupTestEnv.ts"),
            resolve(__dirname, "__tests__/setup/vitest.setup.integration.ts"),
          ],
        },
      },
    ],

    // --- Coverage ---
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
});