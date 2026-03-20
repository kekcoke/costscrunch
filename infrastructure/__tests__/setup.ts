// ─── Infrastructure Test Setup ──────────────────────────────────────────────
import { config } from "dotenv";
import { resolve } from "path";

// Load test environment variables for CDK synthesis assertions
config({ path: resolve(__dirname, "../.env.test") });

export default function setup() {
  // Global setup logic if needed
}
