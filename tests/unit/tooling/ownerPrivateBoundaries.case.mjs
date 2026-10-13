import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'owner-boundaries-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
  let source = readFileSync(new URL('../../../scripts/audit-owner-boundaries.mjs', import.meta.url), 'utf8');
  for (const dependency of ['@babel/parser', '@babel/traverse']) {
    const original = `from '${dependency}'`;
    assert.equal(source.split(original).length, 2);
    source = source.replace(original, `from '${pathToFileURL(createRequire(import.meta.url).resolve(dependency)).href}'`);
  }
  for (const file of ['audit-esm-links.mjs', 'index-snapshot.mjs']) source = source.replace(`from './${file}'`, `from '${new URL('../../../scripts/' + file, import.meta.url).href}'`);
  source = source.replaceAll("from './owner-entry-policy.mjs'", `from '${new URL('../../../scripts/owner-entry-policy.mjs', import.meta.url).href}'`);
  put('scripts/audit-owner-boundaries.mjs', source);
  put('package.json', JSON.stringify({ imports: { '#piano-private': './__app_modules/piano/browser/Private.jsx', '#piano-public': './__app_modules/piano/browser/widget.mjs' } }));
  put('__backend/package.json', JSON.stringify({ imports: { '#piano-private': '../__app_modules/piano/server/Private.mjs', '#piano-public': '../__app_modules/piano/server/public.mjs' } }));
  for (const surface of ['server', 'browser']) {
    const ext = surface === 'browser' ? 'jsx' : 'mjs';
    put(`__app_modules/piano/${surface}/Private.${ext}`, "export const value = 1; throw new Error('Never evaluate source');");
    put(`__app_modules/piano/${surface}/${surface === 'browser' ? 'widget' : 'public'}.mjs`, `export { value } from './Private.${ext}';`);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return { root, put, stage(...files) { execFileSync('git', ['add', '--', ...(files.length ? files : ['.'])], { cwd: root }); }, run(staged = false) {
    return spawnSync(process.execPath, [join(root, 'scripts/audit-owner-boundaries.mjs'), ...(staged ? ['--staged'] : [])], { cwd: root, encoding: 'utf8' });
  } };
}
const green = (r) => assert.equal(r.status, 0, r.stdout + r.stderr);

test('tracked Vite aliases, source queries, extensionless/index paths and literal require cannot bypass privacy', (t) => {
  const f = fixture(t);
  const config = 'frontend/vite.config.js';
  const badConfig = "export default { resolve: { alias: { '@': path.resolve(__dirname, '../__app_modules/piano/browser'), '@gaming': path.resolve(__dirname, '../__app_modules/piano/browser'), '@gaming-ui': path.resolve(__dirname, '../__app_modules/piano/browser') } } };";
  f.put(config, badConfig);
  f.put('__app_modules/piano/browser/folder/index.jsx', 'export const value = 1;');
  f.put('frontend/src/aliases.jsx', "import '@/Private?raw'; export * from '@gaming/folder'; import('@gaming-ui/Private?url');");
  f.put('__backend/src/common.cjs', "require('../../__app_modules/piano/server/Private.mjs'); require.resolve('../../__app_modules/piano/server/Private.mjs');");
  f.stage();
  const bad = f.run();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /5 private owner edge/);
  assert.ok(bad.stderr.includes('folder/index.jsx'));
  f.put('frontend/src/aliases.jsx', "import '@/widget?raw'; export * from '@gaming/widget'; import('@gaming-ui/widget?url');");
  f.put('__backend/src/common.cjs', "require('../../__app_modules/piano/server/public.mjs'); require.resolve('../../__app_modules/piano/server/public.mjs');");
  green(f.run());
  assert.equal(f.run(true).status, 1);
  f.stage('frontend/src/aliases.jsx', '__backend/src/common.cjs');
  green(f.run(true));
  f.put('frontend/src/aliases.jsx', "import '@gaming/Private';");
  f.stage('frontend/src/aliases.jsx');
  f.put(config, badConfig.replace("'@gaming': path.resolve(__dirname, '../__app_modules/piano/browser')", "'@gaming': path.resolve(__dirname, '../frontend/src')"));
  green(f.run());
  const staged = f.run(true);
  assert.equal(staged.status, 1);
  assert.ok(staged.stderr.includes('__app_modules/piano/browser/Private.jsx'));
  f.stage(config);
  green(f.run(true));
});

test('private imports, JSX, literal dynamics and reexports fail; declared entries and test whitebox pass', (t) => {
  const f = fixture(t);
  const consumer = 'frontend/src/consumer.jsx';
  f.put(consumer, "import { value } from '#piano-private'; export { value } from '../../__app_modules/piano/browser/Private.jsx'; import('../../__app_modules/piano/browser/Private.jsx'); export const ui = <span/>; throw new Error('No evaluation');");
  f.put('__app_modules/piano/browser/Own.jsx', "import './Private.jsx';");
  f.put('frontend/src/consumer.test.jsx', "import '#piano-private';");
  f.stage();
  const bad = f.run();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /3 private owner edge/);
  assert.ok(bad.stderr.includes(consumer));
  assert.ok(bad.stderr.includes('#piano-private'));
  f.put(consumer, "import { value } from '#piano-public'; export { value } from '../../__app_modules/piano/browser/widget.mjs'; import('../../__app_modules/piano/browser/widget.mjs'); export const ui = <span/>;");
  green(f.run());
  assert.equal(f.run(true).status, 1);
  f.stage(consumer);
  green(f.run(true));
});

test('root/backend alias scopes and staged manifest bytes cannot hide private edges', (t) => {
  const f = fixture(t);
  f.put('__backend/src/consumer.mjs', "import '#piano-private';");
  f.put('frontend/src/consumer.mjs', "import '#piano-private';");
  f.stage();
  const bad = f.run(true);
  assert.equal(bad.status, 1);
  assert.ok(bad.stderr.includes('__app_modules/piano/server/Private.mjs'));
  assert.ok(bad.stderr.includes('__app_modules/piano/browser/Private.jsx'));
  f.put('package.json', JSON.stringify({ imports: { '#piano-private': './__app_modules/piano/browser/widget.mjs' } }));
  f.put('__backend/package.json', JSON.stringify({ imports: { '#piano-private': '../__app_modules/piano/server/public.mjs' } }));
  green(f.run());
  assert.equal(f.run(true).status, 1);
  f.stage('package.json', '__backend/package.json');
  green(f.run(true));
});

test('cross-owner capability privacy is enforced; generic screen host cannot consume installed products', (t) => {
  const f = fixture(t);
  f.put('__capabilities/playback/browser/Private.js', 'export const value = 1;');
  f.put('__app_modules/piano/browser/playback.jsx', "import '../../../__capabilities/playback/browser/Private.js';");
  f.put('__capabilities/screen-host/browser/installed.mjs', "import '../../../__app_modules/piano/browser/widget.mjs';");
  const bad = f.run();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.ok(bad.stderr.includes('screen-host cannot depend on installed products'));
  assert.ok(bad.stderr.includes('__capabilities/playback/browser/Private.js'));
  f.put('__capabilities/playback/browser/public.mjs', "export { value } from './Private.js';");
  f.put('__app_modules/piano/browser/playback.jsx', "import '../../../__capabilities/playback/browser/public.mjs';");
  f.put('__capabilities/screen-host/browser/installed.mjs', 'export const host = 1;');
  f.put('frontend/src/composition.mjs', "import '../../__app_modules/piano/browser/widget.mjs';");
  green(f.run());
});

test('neutral screen host cannot consume frontend installed composition', (t) => {
  const f = fixture(t);
  f.put('frontend/src/composition/SessionPublisher.js', 'export const value = 1;');
  f.put('__capabilities/screen-host/browser/installed.mjs', "import '../../../frontend/src/composition/SessionPublisher.js';");
  const bad = f.run();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.ok(bad.stderr.includes('screen-host cannot depend on installed composition'));
  f.put('__capabilities/screen-host/browser/installed.mjs', 'export const host = 1;');
  green(f.run());
});

test('retained fixture helpers may use private owners while production cannot import helpers', (t) => {
  const f = fixture(t);
  for (const family of ['_lib', '_fixtures', '_infrastructure']) {
    f.put(`tests/${family}/owner-fixture.mjs`, "import '../../__app_modules/piano/server/Private.mjs';");
    f.put('__backend/src/consumer.mjs', `import '../../tests/${family}/owner-fixture.mjs';`);
    const bad = f.run();
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /production source cannot import a test helper/);
    f.put('__backend/src/consumer.mjs', 'export const neutral = 1;');
    green(f.run());
  }
});


test('production capabilities cannot consume public product entries; test whitebox remains allowed', (t) => {
  const f = fixture(t);
  const consumer = '__capabilities/playback/browser/installed.mjs';
  f.put(consumer, "import '../../../__app_modules/piano/browser/widget.mjs'; export * from '../../../__app_modules/piano/browser/widget.mjs'; import('../../../__app_modules/piano/browser/widget.mjs');");
  f.put('__capabilities/playback/browser/installed.test.mjs', "import '../../../__app_modules/piano/browser/Private.jsx';");
  f.stage();
  for (const staged of [false, true]) {
    const bad = f.run(staged);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /3 private owner edge/);
    assert.match(bad.stderr, /capability cannot depend on application modules, including public entries/);
    assert.ok(!bad.stderr.includes('installed.test.mjs'));
  }
  f.put(consumer, 'export const neutral = 1;');
  green(f.run());
  f.stage(consumer);
  green(f.run(true));
});


test('public product entries cannot hide owner cycles; diagnostics include every cyclic edge', (t) => {
  const f = fixture(t);
  f.put('__app_modules/fitness/browser/kiosk.mjs', "export const value = 1; import '../../../__app_modules/piano/browser/widget.mjs';");
  f.put('__app_modules/piano/browser/cycle.mjs', "import '../../../__app_modules/fitness/browser/kiosk.mjs';");
  f.put('__app_modules/piano/browser/cycle.test.mjs', "import '../../../__app_modules/fitness/browser/kiosk.mjs';");
  f.stage();
  for (const staged of [false, true]) {
    const bad = f.run(staged);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /0 private owner edge\(s\), 1 owner cycle\(s\)/);
    assert.match(bad.stderr, /owner dependency cycle: __app_modules\/fitness, __app_modules\/piano/);
    assert.match(bad.stderr, /__app_modules\/fitness -> __app_modules\/piano: __app_modules\/fitness\/browser\/kiosk.mjs:1/);
    assert.match(bad.stderr, /__app_modules\/piano -> __app_modules\/fitness: __app_modules\/piano\/browser\/cycle.mjs:1/);
    assert.ok(!bad.stderr.includes('cycle.test.mjs'));
  }
  f.put('__app_modules/piano/browser/cycle.mjs', 'export const value = 1;');
  green(f.run());
  f.stage('__app_modules/piano/browser/cycle.mjs');
  green(f.run(true));
});
