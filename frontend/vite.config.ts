import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: {
      // Allows absolute imports: import { X } from "@/components/X"
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    port: 3000,
    // Proxy API calls to local Lambda (via SAM or serverless-offline)
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: true,
    // Split vendor chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ["react", "react-dom"],
          router:   ["react-router-dom"],
          query:    ["@tanstack/react-query"],
          amplify:  ["aws-amplify"],
          charts:   ["recharts"],
        },
      },
    },
  },

  // Vitest config (co-located so `vite` and `vitest` share the same config)
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    include: ["__tests__/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts", "src/mocks/**"],
    },
  },
}));