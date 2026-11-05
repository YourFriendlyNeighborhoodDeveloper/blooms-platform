// Bundles the API server and worker into dist-server, leaving npm packages external
// so production keeps its normal node_modules. Migrations ship next to the bundle,
// because the migrator reads them from the directory of the running file.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist-server');

await fs.rm(out, { recursive: true, force: true });
await build({
  entryPoints: { index: 'server/index.ts', worker: 'server/worker.ts', cli: 'server/db/cli.ts' },
  absWorkingDir: root,
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: out,
  sourcemap: true,
  logLevel: 'warning',
});
await fs.cp(path.join(root, 'server/db/migrations'), path.join(out, 'migrations'), { recursive: true });
console.log('Server bundle written to dist-server');
