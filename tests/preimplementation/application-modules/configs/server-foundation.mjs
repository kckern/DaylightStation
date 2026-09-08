/** Original four-suite selection; no root setup, listeners or controller. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const runRoot = process.env.PRE_RUN_ROOT;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-server-foundation-')) throw new Error('Isolated server-foundation root required');
const selected = JSON.parse(fs.readFileSync(new URL('../fixtures/server-foundation.json', import.meta.url)));
export default {
  root, cacheDir: path.join(runRoot, 'vite-cache'),
  resolve: { alias: { '#backend': path.join(root, 'backend'), '#system': path.join(root, 'backend/src/0_system') } },
  server: { watch: null, middlewareMode: true, hmr: false },
  test: { include: selected.files.map(f => f.path), exclude: ['**/node_modules/**'], environment: 'node', setupFiles: [], globals: true, watch: false, cache: false, pool: 'threads', maxWorkers: 1, fileParallelism: false, passWithNoTests: false },
};
