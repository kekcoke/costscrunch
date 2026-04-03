/**
 * bundle-local.mjs
 * Builds _local/ Lambda handlers into per-function directories for Option 2
 * (LocalStack compute — no SAM required).
 *
 * Output structure:
 *   dist/lambda/
 *   ├── GroupsFunction/index.js
 *   ├── ExpensesFunction/index.js
 *   ├── ReceiptsFunction/index.js
 *   └── AnalyticsFunction/index.js
 *
 * Each directory is zipped and deployed to LocalStack by bootstrap.sh.
 * Handler entrypoint: index.handler (CommonJS)
 */

import esbuild from "esbuild";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "../");

const functions = [
  { name: "GroupsFunction", entry: "src/lambdas/_local/groups.ts" },
  { name: "ExpensesFunction", entry: "src/lambdas/_local/expenses.ts" },
  { name: "ReceiptsFunction", entry: "src/lambdas/_local/receipts.ts" },
  { name: "AnalyticsFunction", entry: "src/lambdas/_local/analytics.ts" },
  { name: "ProfileFunction", entry: "src/lambdas/profile/index.ts" },
  { name: "AuthTriggerFunction", entry: "src/lambdas/auth-trigger/post-confirmation.ts" },
  { name: "SnsWebhookFunction", entry: "src/lambdas/sns-webhook/index.ts" },
  {
    name: "WsNotifierFunction",
    entry: "src/lambdas/web-socket-notifier/index.ts",
  },
  {
    name: "WsHandlerFunction",
    entry: "src/lambdas/web-socket-handler/index.ts",
  },
  { name: "HealthFunction", entry: "src/lambdas/health/index.ts" },
];

async function build() {
  for (const fn of functions) {
    await esbuild.build({
      entryPoints: [join(root, fn.entry)],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs", // Lambda handler: index.handler (CommonJS)
      outfile: join(root, `dist/lambda/${fn.name}/index.js`),
      sourcemap: false,
      minify: false,
      external: ["@aws-sdk/*"],
    });
    console.log(`  ✅ ${fn.name} → dist/lambda/${fn.name}/index.js`);
  }
  console.log("Local Lambda bundles built successfully.");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
