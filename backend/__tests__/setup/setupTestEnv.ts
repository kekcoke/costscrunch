import dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

// import.meta.url is always the absolute path of THIS file, regardless of cwd.
// This file lives at: root/backend/__tests__/setup/setupTestEnv.ts
// .env.test lives at: root/.env.test
// Path:               ../../../.env.test  (setup/ → __tests__/ → backend/ → root/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = resolve(__dirname, "../../../.env.test");

if (!existsSync(envPath)) {
  throw new Error(`[setupTestEnv] .env.test not found at: ${envPath}`);
}

expand(dotenv.config({ path: envPath }));