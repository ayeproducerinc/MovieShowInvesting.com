import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { build } = require('esbuild');
const base = fileURLToPath(new URL('../artifacts/api-server/src/lib/', import.meta.url)).replace(/\/$/, '');
const temp = await mkdtemp(`${tmpdir()}/review-checkout-tests-`);
try {
  await build({
    entryPoints: [`${base}/review-checkout-reconciliation.test.ts`],
    outfile: `${temp}/tests.cjs`, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'isolated-provider-and-db', setup(b) {
      b.onResolve({ filter: /^(@workspace\/db|@replit\/connectors-sdk|drizzle-orm)$/ }, () => ({ path: `${base}/review-checkout.test-fixture.ts` }));
      b.onResolve({ filter: /^\.\/logger$/ }, () => ({ path: `${base}/review-checkout.test-fixture.ts` }));
    } }],
  });
  const result = spawnSync(process.execPath, ['--test', `${temp}/tests.cjs`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }
