// Explicit preparation runner only; intentionally outside default test globs.
/** Native Node fixture only. Manual fixture links are NOT npm adoption proof. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const fixture = path.join(process.env.PRE_RUN_ROOT, 'sibling-packages');
const definitions = {
  'package.json': JSON.stringify({
    name: 'isolated-probe',
    private: true,
    type: 'module',
    workspaces: ['owner/public', 'owner/server', 'owner/web']
  }),
  'owner/public/package.json': JSON.stringify({
    name: '@daylight/probe',
    private: true,
    type: 'module',
    exports: {
      './server/operation': './server.mjs',
      './web/surface': './web.mjs'
    }
  }),
  'owner/public/server.mjs': "export {run} from '@daylight-internal/probe--server/operation';",
  'owner/public/web.mjs': "export {default} from '@daylight-internal/probe--web/surface';",
  'owner/server/package.json': JSON.stringify({
    name: '@daylight-internal/probe--server',
    private: true,
    type: 'module',
    imports: {
      '#value': './value.js'
    },
    exports: {
      './operation': './operation.js'
    }
  }),
  'owner/server/value.js': 'export default 41;',
  'owner/server/operation.js': "import value from '#value';export const run=()=>value+1;",
  'owner/web/package.json': JSON.stringify({
    name: '@daylight-internal/probe--web',
    private: true,
    type: 'commonjs',
    exports: {
      './surface': './surface.js'
    }
  }),
  'owner/web/surface.js': "module.exports = function surface(){return 'web';};",
  'consumer.mjs': "export {run} from '@daylight/probe/server/operation';export {default as surface} from '@daylight/probe/web/surface';export const privateImport=()=>import('@daylight/probe/server/private.js');"
};
for (const [name, content] of Object.entries(definitions)) {
  const full = path.join(fixture, name);
  fs.mkdirSync(path.dirname(full), {
    recursive: true
  });
  fs.writeFileSync(full, content);
}
for (const [name, target] of [['@daylight/probe', 'public'], ['@daylight-internal/probe--server', 'server'], ['@daylight-internal/probe--web', 'web']]) {
  const link = path.join(fixture, 'node_modules', name);
  fs.mkdirSync(path.dirname(link), {
    recursive: true
  });
  fs.symlinkSync(path.join(fixture, 'owner', target), link, 'dir');
}
test('CASE-PKG-SIBLINGS native public forwarding preserves facet type and local imports', async () => {
  const entry = await import(pathToFileURL(path.join(fixture, 'consumer.mjs')));
  assert.equal(entry.run(), 42);
  assert.equal(entry.surface(), 'web');
});
test('CASE-PKG-PRIVATE native public package rejects unexported subpath', async () => {
  const entry = await import(pathToFileURL(path.join(fixture, 'consumer.mjs')));
  await assert.rejects(entry.privateImport(), {
    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED'
  });
});
test('CASE-PKG-NONOVERLAP owner root is not a package and workspace facets are siblings', () => {
  assert.equal(fs.existsSync(path.join(fixture, 'owner/package.json')), false);
  const roots = JSON.parse(definitions['package.json']).workspaces;
  for (const a of roots) for (const b of roots) if (a !== b) assert.equal(b.startsWith(a + '/'), false);
});
test('CASE-PKG-ACTUAL-TIMEZONES existing server and web timezone packages remain distinct', () => {
  const scope = where => createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, where, 'package.json'));
  const backend = scope('backend'),
    frontend = scope('frontend');
  assert.equal(backend('moment-timezone/package.json').version, '0.6.0');
  assert.equal(frontend('moment-timezone/package.json').version, '0.5.47');
  const server = backend('moment-timezone'),
    web = frontend('moment-timezone');
  assert.notEqual(server, web);
  assert.notEqual(server.tz, web.tz);
  const webData = web.tz.dataVersion;
  server.tz.load({
    version: 'audit-only',
    zones: [],
    links: []
  });
  assert.equal(web.tz.dataVersion, webData);
  assert.equal(server.tz.dataVersion, 'audit-only');
  process.stderr.write('PACKAGE_LIMIT existing installs only; no new npm lock, reinstall or reverse-import-order child proof\n');
});

test('CASE-PKG-ROOT-TIMEZONE the root scope is a third real timezone instance', () => {
  const rootRequire = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'));
  const backend = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'backend/package.json'));
  const frontend = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'frontend/package.json'));
  assert.equal(rootRequire('moment-timezone/package.json').version, '0.5.46');
  assert.notEqual(rootRequire('moment-timezone'), backend('moment-timezone'));
  assert.notEqual(rootRequire('moment-timezone'), frontend('moment-timezone'));
  assert.notEqual(rootRequire('moment-timezone').tz.dataVersion, 'audit-only');
});

test('CASE-PKG-REACT actual React and renderer share identity; duplicate hooks/context fail the contract', () => {
  const frontend = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'frontend/package.json'));
  const React = frontend('react');
  const rendererRequire = createRequire(frontend.resolve('react-dom/server'));
  assert.equal(frontend('react/package.json').version, '18.3.1');
  assert.equal(frontend('react-dom/package.json').version, '18.3.1');
  assert.equal(rendererRequire('react'), React);
  const {renderToStaticMarkup} = frontend('react-dom/server');
  const context = React.createContext('missing-provider');
  function HealthyConsumer() { return React.createElement('p', null, React.useContext(context)); }
  const render = Consumer => renderToStaticMarkup(React.createElement(context.Provider,
    {value: 'synthetic-provider'}, React.createElement(Consumer)));
  assert.equal(render(HealthyConsumer), '<p>synthetic-provider</p>');

  // Copy only real React package bytes into this task's temporary fixture.
  // No repository or existing installation is modified; this is not npm adoption.
  const copied = path.join(process.env.PRE_RUN_ROOT, 'duplicate-react');
  fs.cpSync(path.dirname(frontend.resolve('react/package.json')), copied, {recursive: true});
  const DuplicateReact = createRequire(path.join(copied, 'package.json'))(copied);
  assert.notEqual(DuplicateReact, React);
  function WrongHooks() { return React.createElement('p', null, DuplicateReact.useContext(context)); }
  assert.throws(() => render(WrongHooks), /useContext/);
  assert.equal(render(HealthyConsumer), '<p>synthetic-provider</p>');

  const copiedContext = React.createContext('missing-provider');
  function WrongContext() { return React.createElement('p', null, React.useContext(copiedContext)); }
  assert.equal(render(WrongContext), '<p>missing-provider</p>');
  assert.equal(render(HealthyConsumer), '<p>synthetic-provider</p>');
  process.stderr.write('PACKAGE_PROOF duplicate real React dispatcher rejected; separate context misses provider; restored shared identities render correctly\n');
});

test('CASE-PKG-NATIVE actual root/backend canvas versions and constructor identities stay separate', () => {
  const rootRequire = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'));
  const backend = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'backend/package.json'));
  assert.equal(rootRequire('canvas/package.json').version, '3.2.1');
  assert.equal(backend('canvas/package.json').version, '3.1.0');
  const rootCanvas = rootRequire('canvas'), serverCanvas = backend('canvas');
  assert.notEqual(rootCanvas, serverCanvas);
  assert.notEqual(rootCanvas.Canvas, serverCanvas.Canvas);
  for (const canvasModule of [rootCanvas, serverCanvas]) {
    const canvas = canvasModule.createCanvas(2, 3);
    const png = canvas.toBuffer('image/png');
    assert.equal(canvas instanceof canvasModule.Canvas, true);
    assert.equal(png.readUInt32BE(16), 2);
    assert.equal(png.readUInt32BE(20), 3);
  }
  process.stderr.write('PACKAGE_LIMIT actual macOS native modules loaded; no Linux image, rebuild or ABI portability proof\n');
});
