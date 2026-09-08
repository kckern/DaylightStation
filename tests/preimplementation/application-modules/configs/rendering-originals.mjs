/** Exact original suites in disposable old/new layouts; no source aliases or root setup. */
import fs from 'node:fs';
import path from 'node:path';
const runRoot = process.env.PRE_RUN_ROOT;
const variant = process.env.PRE_RENDERING_VARIANT;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-rendering-identity-') || !['baseline', 'candidate'].includes(variant)) throw new Error('Task-owned rendering fixture required');
const selected = JSON.parse(fs.readFileSync(new URL('../fixtures/rendering-identity.json', import.meta.url)));
export default {
  root: path.join(runRoot, variant), cacheDir: path.join(runRoot, variant, 'vite-cache'),
  server: { watch: null, middlewareMode: true, hmr: false },
  test: {
    include: selected.originals.map(f => f.path), exclude: ['**/node_modules/**'],
    environment: 'node', setupFiles: [], globals: false, watch: false, cache: false,
    pool: 'threads', maxWorkers: 1, fileParallelism: false, passWithNoTests: false,
  },
};
