/** Disposable package mechanism only; never inherit controller/root test setup. */
import path from 'node:path';
const runRoot = process.env.PRE_RUN_ROOT;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-fileio-identity-')) throw new Error('Task-owned run root required');
export default {
  root: path.join(runRoot, 'fixture'),
  cacheDir: path.join(runRoot, 'vite-cache'),
  server: { watch: null, middlewareMode: true, hmr: false },
  test: {
    include: ['mock.test.mjs'], exclude: ['**/node_modules/**'],
    environment: 'node', setupFiles: [], globals: false, watch: false,
    cache: false, pool: 'threads', maxWorkers: 1, fileParallelism: false,
    passWithNoTests: false,
  },
};
