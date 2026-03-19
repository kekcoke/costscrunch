import { defineConfig } from "vitest/config";
import { resolve } from "path";

// ─── CostsCrunch — Infrastructure Test Configuration ────────────────────────
// Flat config — opt2 tests self-skip when LocalStack isn't reachable.
//
// Usage:
//   # Run all infra tests (opt3 always runs, opt2 skips without LocalStack)
//   npx vitest --config infrastructure/vite.config.ts
//
//   # Run only Option 3 unit tests
//   npx vitest --config infrastructure/vite.config.ts __tests__/opt3
//
//   # Run only Option 2 integration tests (requires LocalStack)
//   npx vitest --config infrastructure/vite.config.ts __tests__/opt2

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
    globals: true,
    // Integration tests need longer timeouts
    testTimeout: 15_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../backend/src/shared"),
      "@lambdas": resolve(__dirname, "../backend/src/lambdas"),
    },
  },
});
