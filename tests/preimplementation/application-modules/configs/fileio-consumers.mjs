/** Original allowlisted tests only; no ordinary root setup, server or reports. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const runRoot = process.env.PRE_RUN_ROOT;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-fileio-consumers-')) throw new Error('Isolated FileIO consumer root required');
const selected = JSON.parse(fs.readFileSync(new URL('../fixtures/fileio-consumers.json', import.meta.url)));
export default {
  root, cacheDir: path.join(runRoot, 'vite-cache'),
  resolve: { alias: Object.fromEntries([['#adapters', '1_adapters'], ['#apps', '3_applications'], ['#system', '0_system'], ['#domains', '2_domains']].map(([alias, layer]) => [alias, path.join(root, 'backend/src', layer)])) },
  server: { watch: null, middlewareMode: true, hmr: false },
  test: { include: selected.files.map(f => f.path), exclude: ['**/node_modules/**'], environment: 'node', setupFiles: [], globals: false, watch: false, cache: false, pool: 'threads', maxWorkers: 1, fileParallelism: false, passWithNoTests: false },
};
