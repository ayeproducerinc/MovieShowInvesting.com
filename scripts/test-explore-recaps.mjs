import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const apiRequire = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { build } = apiRequire('esbuild');
const webDir = fileURLToPath(new URL('../artifacts/movie-show-investing/', import.meta.url));
const temp = await mkdtemp(`${tmpdir()}/explore-recap-tests-`);
try {
  await build({
    entryPoints: [`${webDir}/src/components/investor-project-card.test.tsx`],
    outfile: `${temp}/tests.cjs`, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    alias: { '@': `${webDir}/src` }, logLevel: 'error',
  });
  const result = spawnSync(process.execPath, ['--test', `${temp}/tests.cjs`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
