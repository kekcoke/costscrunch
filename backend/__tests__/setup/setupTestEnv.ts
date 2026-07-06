import dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

// import.meta.url is always the absolute path of THIS file, regardless of cwd.
// This file lives at: root/backend/__tests__/setup/setupTestEnv.ts
// .env.shared lives at: root/.env.shared
// Path:                 ../../../.env.shared  (setup/ → __tests__/ → backend/ → root/)
const __dirname = dirname(fileURLToPath(import.meta.url));

// Determine environment and set local as default if none is provided
const environment = process.env.ENVIRONMENT || 'shared'
const envPath   = resolve(__dirname, `../../../.env.${environment}`);

if (!existsSync(envPath)) {
  throw new Error(`[setupTestEnv] .env.${environment} not found at: ${envPath}`);
}

expand(dotenv.config({ path: envPath }));