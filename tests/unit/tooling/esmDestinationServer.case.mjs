import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'esm-owner-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  let source = readFileSync(new URL('../../../scripts/audit-esm-links.mjs', import.meta.url), 'utf8');
  for (const dependency of ['@babel/parser', '@babel/traverse']) {
    const original = `from '${dependency}'`;
    assert.equal(source.split(original).length, 2);
    source = source.replace(original, `from '${pathToFileURL(createRequire(import.meta.url).resolve(dependency)).href}'`);
  }
  put('scripts/audit-esm-links.mjs', source);
  put('scripts/index-snapshot.mjs', readFileSync(new URL('../../../scripts/index-snapshot.mjs', import.meta.url), 'utf8'));
  put('package.json', JSON.stringify({ imports: { '#root': './cli/target.mjs' } }));
  put('__backend/package.json', JSON.stringify({ imports: { '#root': './src/target.mjs' } }));
  put('cli/target.mjs', "export const rootValue = 1; throw new Error('Source never evaluated');");
  put('__backend/src/target.mjs', "export const backendValue = 1; throw new Error('Source never evaluated');");
  put('__backend/src/consumer.mjs', "import { backendValue } from '#root'; throw new Error('Never evaluated');");
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return { root, put, stage(...files) { execFileSync('git', ['add', '--', ...(files.length ? files : ['.'])], { cwd: root }); }, run(staged = false) {
    return spawnSync(process.execPath, [join(root, 'scripts/audit-esm-links.mjs'), ...(staged ? ['--staged'] : [])], { cwd: root, encoding: 'utf8' });
  } };
}
const green = (result) => assert.equal(result.status, 0, result.stdout + result.stderr);

test('ESM CLI preserves legal legacy roots and accepts absent destination roots in both modes', (t) => {
  const f = fixture(t);
  f.stage();
  for (const staged of [false, true]) {
    const result = f.run(staged);
    green(result);
    assert.match(result.stdout, /3 (?:staged )?modules checked/);
  }
});

test('staged ESM CLI handles owner inventories larger than the default subprocess buffer', (t) => {
  const f = fixture(t);
  f.stage();
  const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: f.root, input: '', encoding: 'utf8' }).trim();
  const entries = Array.from({ length: 4000 }, (_, i) =>
    `100644 ${blob}\t__app_modules/piano/server/inventory/${i}-${'x'.repeat(220)}.txt\0`).join('');
  execFileSync('git', ['update-index', '-z', '--index-info'], { cwd: f.root, input: entries });
  const inventory = execFileSync('git', ['ls-files', '--stage', '-z', '--', '__app_modules'],
    { cwd: f.root, maxBuffer: 16 * 1024 * 1024 });
  assert.ok(inventory.length > 1024 * 1024);
  const result = f.run(true);
  assert.equal(result.status, 0, result.stderr.slice(0, 1200));
  assert.match(result.stdout, /3 staged modules checked/);
});

for (const root of ['__app_modules', '__capabilities']) {
  for (const ext of ['mjs', 'js', 'cjs']) {
    test(`${root}: ${ext} destination source and package aliases obey working/index bytes`, (t) => {
      const f = fixture(t);
      const server = `${root}/gratitude/server`;
      const entry = `${server}/public.${ext}`;
      f.put(`${server}/target.${ext}`, "export const current = 1; throw new Error('Never evaluated');");
      const fixed = `import { current } from './target.${ext}'; export { current } from './target.${ext}'; const { current: value } = await import('./target.${ext}'); import { rootValue } from '#root'; throw new Error('Never evaluated');`;
      f.put(entry, `import { removed } from './target.${ext}'; export { gone } from './target.${ext}'; const { absent } = await import('./target.${ext}'); import './missing.${ext}';`);
      for (const dir of ['vendor', '.cache', 'node_modules']) f.put(`${server}/${dir}/ignored.${ext}`, "import './missing.mjs';");
      f.put(`${root}/gratitude/browser/Broken.jsx`, 'invalid browser syntax !');
      symlinkSync(join(f.root, server), join(f.root, server, 'loop'));
      symlinkSync(join(f.root, server, `target.${ext}`), join(f.root, server, `alias.${ext}`));
      f.stage();
      const broken = f.run();
      assert.equal(broken.status, 1, broken.stdout + broken.stderr);
      assert.ok(broken.stderr.includes(entry));
      for (const name of ['removed', 'gone', 'absent', 'module target does not exist']) assert.ok(broken.stderr.includes(name));
      f.put(entry, fixed);
      green(f.run());
      const stagedBroken = f.run(true);
      assert.equal(stagedBroken.status, 1);
      assert.ok(stagedBroken.stderr.includes('removed'));
      f.stage(entry);
      green(f.run(true));
      f.put('package.json', JSON.stringify({ imports: { '#root': './cli/missing.mjs' } }));
      f.stage('package.json');
      f.put('package.json', JSON.stringify({ imports: { '#root': './cli/target.mjs' } }));
      green(f.run());
      const aliasBroken = f.run(true);
      assert.equal(aliasBroken.status, 1);
      assert.ok(aliasBroken.stderr.includes('#root — module target does not exist'));
      f.stage('package.json');
      const repaired = f.run(true);
      green(repaired);
      assert.match(repaired.stdout, /5 staged modules checked/);
    });
  }
}
