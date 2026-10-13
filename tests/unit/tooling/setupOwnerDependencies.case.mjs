import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readlinkSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const load = () => import('../../../scripts/setup-owner-dependencies.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'owner-dependencies-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  return { root, put };
}

test('owner setup skips absent roots, links only runtime surfaces, and is idempotent before install', async (t) => {
  const { setupOwnerDependencies } = await load();
  const f = fixture(t);
  assert.deepEqual(setupOwnerDependencies(f.root), []);
  for (const ownerRoot of ['__app_modules', '__capabilities']) {
    for (const surface of ['server', 'browser']) mkdirSync(join(f.root, ownerRoot, 'owner', surface), { recursive: true });
    mkdirSync(join(f.root, ownerRoot, 'owner', 'assets'));
    symlinkSync(join(f.root, ownerRoot, 'owner'), join(f.root, ownerRoot, 'linked-owner'));
  }
  const first = setupOwnerDependencies(f.root);
  assert.equal(first.length, 4);
  assert.ok(first.every((link) => !link.exists));
  for (const link of first) assert.equal(readlinkSync(link.link), link.target);
  assert.equal(existsSync(join(f.root, '__app_modules/owner/assets/node_modules')), false);
  assert.ok(setupOwnerDependencies(f.root).every((link) => link.exists));
  assert.throws(() => setupOwnerDependencies(f.root, { check: true }), /Missing dependency target/i);
  for (const surface of ['__backend', 'frontend']) mkdirSync(join(f.root, surface, 'node_modules'), { recursive: true });
  assert.equal(setupOwnerDependencies(f.root, { check: true }).length, 4);
});

test('owner setup refuses real dependency paths and unexpected links; check never creates', async (t) => {
  const { setupOwnerDependencies } = await load();
  const f = fixture(t);
  const dir = join(f.root, '__app_modules/owner/server');
  mkdirSync(dir, { recursive: true });
  assert.throws(() => setupOwnerDependencies(f.root, { check: true }), /missing/i);
  assert.equal(existsSync(join(dir, 'node_modules')), false);
  mkdirSync(join(dir, 'node_modules'));
  assert.throws(() => setupOwnerDependencies(f.root), /refus/i);
  rmSync(join(dir, 'node_modules'), { recursive: true });
  symlinkSync('../../../unexpected/node_modules', join(dir, 'node_modules'));
  assert.throws(() => setupOwnerDependencies(f.root), /Refusing/i);
  assert.equal(readlinkSync(join(dir, 'node_modules')), '../../../unexpected/node_modules');
});

test('ordinary import, require, dynamic exports and canonical identity use runtime dependencies instead of root fallback', async (t) => {
  const { setupOwnerDependencies } = await load();
  const f = fixture(t);
  for (const scope of ['__backend', 'frontend', '']) {
    const base = `${scope ? scope + '/' : ''}node_modules/scope-probe`;
    f.put(`${base}/package.json`, JSON.stringify({ name: 'scope-probe', type: 'module', exports: { import: './import.mjs', require: './require.cjs' } }));
    f.put(`${base}/import.mjs`, `export const scope = '${scope || 'root'}'; export const identity = {};`);
    f.put(`${base}/require.cjs`, `module.exports = { scope: '${scope || 'root'}' };`);
  }
  for (const ownerRoot of ['__app_modules', '__capabilities']) {
    for (const surface of ['server', 'browser']) {
      f.put(`${ownerRoot}/owner/${surface}/probe.mjs`, "import { scope, identity } from 'scope-probe'; export { scope, identity }; export const dynamic = () => import('scope-probe');");
    }
  }
  setupOwnerDependencies(f.root);
  setupOwnerDependencies(f.root, { check: true });
  for (const ownerRoot of ['__app_modules', '__capabilities']) {
    for (const surface of ['server', 'browser']) {
      const expected = surface === 'server' ? '__backend' : 'frontend';
      const entry = join(f.root, ownerRoot, 'owner', surface, 'probe.mjs');
      const loaded = await import(pathToFileURL(entry).href);
      const canonical = await import(pathToFileURL(join(f.root, expected, 'node_modules/scope-probe/import.mjs')).href);
      assert.equal(loaded.scope, expected);
      assert.equal((await loaded.dynamic()).identity, canonical.identity);
      assert.equal(loaded.identity, canonical.identity);
      const require = createRequire(entry);
      assert.equal(require('scope-probe').scope, expected);
      assert.equal(require.resolve('scope-probe'), realpathSync(join(f.root, expected, 'node_modules/scope-probe/require.cjs')));
    }
  }
});
