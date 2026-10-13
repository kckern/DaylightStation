import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
function fixture(t, backendRoot = 'backend') {
  const root = mkdtempSync(join(tmpdir(), 'api-route-roots-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  put('scripts/audit-api-route-surface.mjs', readFileSync(join(repo, 'scripts/audit-api-route-surface.mjs'), 'utf8'));
  put(`${backendRoot}/src/4_api/routes.mjs`, "router.get('/kept', handler);\n");
  put(`${backendRoot}/src/0_system/http/placeholder.mjs`, 'export const placeholder = true;\n');
  put(`${backendRoot}/src/app.mjs`, 'export const app = true;\n');
  put('.gitignore', 'node_modules\n');
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Route baseline'], { cwd: root });
  if (backendRoot === 'backend') renameSync(join(root, 'backend'), join(root, '__backend'));
  const run = () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts/audit-api-route-surface.mjs'), '--base=HEAD'],
      { cwd: root, encoding: 'utf8' });
    assert.ok(result.stdout, result.stderr);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  return { put, run };
}

for (const baselineRoot of ['backend', '__backend']) {
  test(`route audit preserves a ${baselineRoot} baseline across developer-root naming`, (t) => {
    const f = fixture(t, baselineRoot);
    const { status, report } = f.run();
    assert.equal(status, 0);
    assert.equal(report.baselineLiteralRegistrations, 1);
    assert.equal(report.currentLiteralRegistrations, 1);
    assert.deepEqual(report.removed, []);
    assert.deepEqual(report.added, []);
  });
}

test('route audit still rejects an actual removal from a pre-rename baseline', (t) => {
  const f = fixture(t);
  f.put('__backend/src/4_api/routes.mjs', 'export const removed = true;\n');
  const { status, report } = f.run();
  assert.equal(status, 1);
  assert.equal(report.baselineLiteralRegistrations, 1);
  assert.deepEqual(report.removed, [{ route: 'GET /kept', count: 1 }]);
});
