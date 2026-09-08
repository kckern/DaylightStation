/** Original assertion bodies over task-owned packages; no aliases or root setup. */
import fs from 'node:fs';
import path from 'node:path';
const runRoot = process.env.PRE_RUN_ROOT;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-http-identity-')) throw new Error('Task-owned HTTP run root required');
const selected = JSON.parse(fs.readFileSync(new URL('../fixtures/server-foundation.json', import.meta.url)));
export default {
  root: path.join(runRoot, 'fixture'),
  cacheDir: path.join(runRoot, 'vite-cache'),
  server: { watch: null, middlewareMode: true, hmr: false },
  test: {
    include: selected.files.map(f => f.path), exclude: ['**/node_modules/**'],
    environment: 'node', setupFiles: [], globals: true, watch: false,
    cache: false, pool: 'threads', maxWorkers: 1, fileParallelism: false,
    passWithNoTests: false,
  },
};
