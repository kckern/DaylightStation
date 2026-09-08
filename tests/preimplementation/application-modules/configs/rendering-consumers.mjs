/** Keep original root/backend Vitest scopes separate; explicit selected originals only. */
import fs from 'node:fs';
import path from 'node:path';
const runRoot = process.env.PRE_RUN_ROOT, variant = process.env.PRE_RENDERING_VARIANT, scope = process.env.PRE_RENDERING_SCOPE;
if (!runRoot || !path.basename(runRoot).startsWith('daylight-rendering-consumers-') || !['baseline', 'candidate'].includes(variant) || !['root', 'backend'].includes(scope)) throw new Error('Explicit disposable rendering scope required');
const selected = JSON.parse(fs.readFileSync(new URL('../../../../docs/_wip/audits/2026-09-05-application-module-preimplementation/rendering-consumer-review.json', import.meta.url)));
export default {
  root: path.join(runRoot, variant), cacheDir: path.join(runRoot, variant, 'vite-cache-' + scope),
  server: { watch: null, middlewareMode: true, hmr: false },
  test: {
    include: selected.suites.filter(s => s.runner === 'vitest' && s.runtimeScope === scope).map(s => s.path),
    exclude: ['**/node_modules/**'], environment: 'node', setupFiles: [], globals: false,
    watch: false, cache: false, pool: 'threads', maxWorkers: 1, fileParallelism: false,
    passWithNoTests: false,
  },
};
