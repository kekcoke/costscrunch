// ─── Infrastructure Test Setup ──────────────────────────────────────────────
import { config } from "dotenv";
import { resolve } from "path";


// Determine environment and set local as default if none is provided
const environment = process.env.ENVIRONMENT || 'dev'

// Load test environment variables for CDK synthesis assertions
config({ path: resolve(__dirname, `../.env.${environment}`) });

export default function setup() {
  // Global setup logic if needed
}
