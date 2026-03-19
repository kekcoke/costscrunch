import esbuild from 'esbuild';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const entryPoints = [
  'src/server.ts',
  'src/lambdas/analytics/index.ts',
  'src/lambdas/expenses/index.ts',
  'src/lambdas/groups/index.ts',
  'src/lambdas/image-preprocess/index.ts',
  'src/lambdas/notifications/index.ts',
  'src/lambdas/receipts/index.ts',
  'src/lambdas/sns-webhook/index.ts',
  'src/lambdas/web-socket-notifier/index.ts'
];

async function build() {
  await esbuild.build({
    entryPoints: entryPoints.map(p => join(__dirname, '../', p)),
    bundle: true,
    platform: 'node',
    target: 'node20',
    outdir: join(__dirname, '../dist'),
    format: 'esm',
    sourcemap: true,
    minify: false,
    outExtension: { '.js': '.mjs' },
    external: ['@aws-sdk/*'],
  });
  console.log('Backend bundled successfully.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
