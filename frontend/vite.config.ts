import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig(() => {
  // .env.test is only auto-loaded in vitest mode; load explicitly for dev too
  const { VITE_API_URL } = loadEnv("test", resolve(__dirname, ".."));

  return {
  // Load .env files from monorepo root (e.g. .env.test)
  envDir: resolve(__dirname, ".."),
  // Inject VITE_API_URL from .env.test into import.meta.env for all modes
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(VITE_API_URL),
  },
  plugins: [react()],

  resolve: {
    alias: {
      // Allows absolute imports: import { X } from "@/components/X"
      "@src": resolve(__dirname, "./src"),
      "@tests": resolve(__dirname, "__tests__") 
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
          amplify:  ["@aws-amplify/auth"],
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
  };
});