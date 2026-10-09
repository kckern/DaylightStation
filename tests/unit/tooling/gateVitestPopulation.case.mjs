import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vitest-population-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  // A copied gate scans only synthetic text. Any child launch is intercepted
  // before it could execute Vitest, npx, a product import, or a network command.
  const source = readFileSync(new URL('../../../scripts/gate-vitest.mjs', import.meta.url), 'utf8');
  put('scripts/gate-vitest.mjs', source.replace("from 'node:child_process'", "from './child-stub.mjs'"));
  put('scripts/child-stub.mjs', "import { writeFileSync } from 'node:fs'; export function spawnSync() { writeFileSync(new URL('../child-started', import.meta.url), 'bad'); throw new Error('Child execution forbidden'); }");
  const sentinels = ['scripts/audit-baseline.vitest.txt', 'tests/output/results.gate-vitest.json', 'tests/output/results.gate-vitest.json.prev'];
  for (const file of sentinels) put(file, `sentinel:${file}`);
  return { root, put, list() {
    const result = spawnSync(process.execPath, [join(root, 'scripts/gate-vitest.mjs'), '--list', '--update'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `stdout bytes=${Buffer.byteLength(result.stdout)}; stderr=${result.stderr.slice(0, 1000)}`);
    assert.equal(result.stderr, '');
    assert.equal(existsSync(join(root, 'child-started')), false);
    for (const file of sentinels) assert.equal(readFileSync(join(root, file), 'utf8'), `sentinel:${file}`);
    return JSON.parse(result.stdout);
  } };
}

const vitest = "import { test } from 'vitest'; test('synthetic', () => {});";
test('list flushes a complete JSON population larger than 128 KiB through a pipe', (t) => {
  const f = fixture(t);
  const expected = [];
  for (let i = 0; i < 700; i++) {
    const file = `modules/sample/browser/${'long-name-'.repeat(23)}${String(i).padStart(4, '0')}.test.js`;
    f.put(file, vitest);
    expected.push(file);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(expected)) > 128 * 1024);
  assert.deepEqual(f.list(), expected);
});
test('list retains legacy population with absent destination roots and performs no execution or writes', (t) => {
  const f = fixture(t);
  const expected = ['backend/legacy.test.mjs', 'frontend/legacy.test.jsx', 'shared/legacy.test.js', 'tests/isolated/legacy.test.mjs', 'tests/unit/legacy.test.mjs'];
  for (const file of expected) f.put(file, vitest);
  f.put('tests/unit/suite/jest.test.mjs', "describe('jest', () => {});");
  assert.deepEqual(f.list(), expected);
  assert.deepEqual(f.list(), expected);
});

test('list discovers destination server/browser tests exactly once and excludes other runners and symlinks', (t) => {
  const f = fixture(t);
  f.put('backend/legacy.test.mjs', vitest);
  const expected = ['backend/legacy.test.mjs'];
  for (const root of ['modules', 'capabilities']) {
    for (const surface of ['server', 'browser']) {
      const dir = `${root}/sample/${surface}`;
      const file = `${dir}/owned.test.${surface === 'server' ? 'mjs' : 'jsx'}`;
      f.put(file, vitest);
      expected.push(file);
      f.put(`${dir}/node.test.mjs`, "import { test } from 'node:test'; test('node', () => {});");
      f.put(`${dir}/jest.test.js`, "import { test } from '@jest/globals'; test('jest', () => {});");
      f.put(`${dir}/node_modules/ignored.test.js`, vitest);
      symlinkSync(join(f.root, file), join(f.root, dir, 'alias.test.mjs'));
      symlinkSync(join(f.root, dir), join(f.root, dir, 'loop'));
    }
  }
  assert.deepEqual(f.list(), expected.sort());
  assert.deepEqual(f.list(), expected);
});
