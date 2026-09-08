/** Native/actual Vitest facade experiments; no migration, install or root loader. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';

const self = fileURLToPath(import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const originalPath = 'backend/src/0_system/utils/FileIO.mjs';
const publicTarget = '@daylight/platform/server/system/utils/file-io';
const privateTarget = '@daylight-internal/platform--server/system/utils/file-io';
const profile = path.join(testRoot, 'configs/package-install.sbp');
const config = path.join(testRoot, 'configs/fileio-identity.mjs');
const templates = ['fixtures/fileio-identity/native.mjs', 'fixtures/fileio-identity/mock.mjs'];
const selectedMode = process.argv[2] === '--worker' ? process.argv[3] === 'selected' : process.argv[2] === 'selected';
const selectedSpecPath = path.join(packet, 'fileio-boundary.json');

if (process.argv[2] === '--worker') {
  assert.ok(process.argv.length === 3 || process.argv.length === 4 && selectedMode, 'Unknown worker mode');
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT);
  if (!path.basename(runRoot).startsWith('daylight-fileio-identity-')) throw new Error('Refuse non-task root');
  const fixture = path.join(runRoot, 'fixture');
  fs.mkdirSync(fixture);
  const write = (name, value) => {
    const target = path.resolve(fixture, name);
    assert.ok(target.startsWith(fixture + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  const link = (from, name) => {
    const target = path.join(fixture, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(from, target, 'dir');
  };
  const original = fs.readFileSync(path.join(root, originalPath), 'utf8');
  const ledger = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
  assert.equal(sha(original), ledger.files.find(f => f.path === originalPath).sha256, 'Protected FileIO source mismatch');
  const privateNames = [...original.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => m[1]);
  assert.equal(privateNames.length, 77);
  const selectedSpec = selectedMode ? JSON.parse(fs.readFileSync(selectedSpecPath)) : null;
  const names = selectedSpec ? selectedSpec.facade.names : privateNames;
  assert.equal(names.length, selectedMode ? 73 : 77);
  assert.ok(names.every(name => privateNames.includes(name)));
  if (selectedSpec) assert.equal(selectedSpec.implementation.sha256, sha(original));
  const version = name => JSON.parse(fs.readFileSync(path.join(toolRoot, 'node_modules', name, 'package.json'))).version;
  const deps = {};
  const runtimeInputs = [];
  for (const name of ['axios', 'js-yaml']) {
    const manifestPath = path.join(toolRoot, 'backend/node_modules', name, 'package.json');
    deps[name] = JSON.parse(fs.readFileSync(manifestPath)).version;
    link(path.dirname(manifestPath), 'platform/server/node_modules/' + name);
    runtimeInputs.push({ scope: 'backend', path: 'node_modules/' + name + '/package.json', sha256: sha(fs.readFileSync(manifestPath)) });
  }
  link(path.join(toolRoot, 'node_modules/vitest'), 'node_modules/vitest');
  link(path.join(fixture, 'platform/public'), 'node_modules/@daylight/platform');
  link(path.join(fixture, 'platform/server'), 'node_modules/@daylight-internal/platform--server');
  write('package.json', { name: 'daylight-fileio-identity-probe', private: true, type: 'module', workspaces: ['platform/public', 'platform/server'], dependencies: { '@daylight/platform': '0.0.0' } });
  write('platform/public/package.json', { name: '@daylight/platform', private: true, version: '0.0.0', type: 'module', exports: { './server/system/utils/file-io': './server/file-io.mjs' }, dependencies: { '@daylight-internal/platform--server': '0.0.0' } });
  write('platform/server/package.json', { name: '@daylight-internal/platform--server', private: true, version: '0.0.0', type: 'module', exports: { './system/utils/file-io': './system/utils/FileIO.mjs' }, dependencies: deps });
  const facade = `export { ${names.join(', ')} } from '${privateTarget}';\n`;
  if (selectedSpec) assert.equal(facade, selectedSpec.facade.sourceText, 'Selected facade bytes must match selected planning specification');
  write('platform/public/server/file-io.mjs', facade);
  write('platform/server/system/utils/FileIO.mjs', original);
  write('platform/server/system/reader.mjs', "import {loadYaml} from './utils/FileIO.mjs'; export const read = target => loadYaml(target);\n");
  write('external-reader.mjs', `import {loadYaml} from '${publicTarget}'; export const read = target => loadYaml(target);\n`);
  write('native.mjs', fs.readFileSync(path.join(testRoot, templates[0]), 'utf8'));
  write('expected-public.json', { selected: selectedMode, names, privateOnly: privateNames.filter(name => !names.includes(name)) });
  fs.writeFileSync(path.join(runRoot, 'sample.yml'), 'origin: actual\n');
  fs.mkdirSync(path.join(runRoot, 'directory'));
  fs.writeFileSync(path.join(runRoot, 'directory/0017-example.yml'), 'id: 17\n');
  const mockTemplate = fs.readFileSync(path.join(testRoot, templates[1]), 'utf8');
  const records = [];
  const run = (label, args, expectedExit, expectedFailedNames = [], diagnostic = null) => {
    const r = spawnSync(process.execPath, args, { cwd: fixture, env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    let outcome = null;
    if (label.startsWith('vitest-')) {
      const output = path.join(runRoot, label + '.json');
      if (fs.existsSync(output)) outcome = JSON.parse(fs.readFileSync(output, 'utf8'));
    }
    const assertions = outcome?.testResults?.flatMap(s => s.assertionResults) || [];
    const actualFailedNames = assertions.filter(a => a.status === 'failed').map(a => a.title.split(':')[0]).sort();
    const populationMatches = outcome ? outcome.numTotalTests === 3 && assertions.length === 3
      && assertions.every(a => ['passed', 'failed'].includes(a.status))
      && outcome.numFailedTests === expectedFailedNames.length
      && outcome.numPassedTests === 3 - expectedFailedNames.length
      && JSON.stringify(actualFailedNames) === JSON.stringify([...expectedFailedNames].sort()) : !label.startsWith('vitest-');
    const expectedDiagnostic = !diagnostic || r.stderr.includes(diagnostic);
    records.push({ label, exitCode: r.status, expectedExit, expectedFailedNames, populationMatches, expectedDiagnostic, outcome, stdout: r.stdout, stderr: r.stderr, error: r.error?.message });
    assert.equal(r.status, expectedExit, label + ': ' + r.stderr);
    assert.ok(populationMatches, label + ': wrong assertion population');
    assert.ok(expectedDiagnostic, label + ': wrong failure diagnostic');
  };
  const vitest = (label, target, factory, failed = []) => {
    write('mock.test.mjs', mockTemplate.replace('__MOCK_TARGET__', target).replace('__MOCK_FACTORY__', factory));
    run(label, [path.join(toolRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--configLoader', 'native', '--reporter=json', '--outputFile=' + path.join(runRoot, label + '.json')], failed.length ? 1 : 0, failed);
  };
  let outcome;
  try {
    run('native-initial', [path.join(fixture, 'native.mjs')], 0);
    // A second byte-identical implementation is deliberately wrong.
    write('platform/public/server/copied-FileIO.mjs', original);
    link(path.join(toolRoot, 'backend/node_modules/axios'), 'platform/public/node_modules/axios');
    link(path.join(toolRoot, 'backend/node_modules/js-yaml'), 'platform/public/node_modules/js-yaml');
    write('platform/public/server/file-io.mjs', `export { ${names.join(', ')} } from './copied-FileIO.mjs';\n`);
    run('native-duplicate-red', [path.join(fixture, 'native.mjs')], 1, [], 'FILEIO_BINDING_IDENTITY');
    write('platform/public/server/file-io.mjs', facade);
    run('native-restored', [path.join(fixture, 'native.mjs')], 0);
    vitest('vitest-public-mock-red', publicTarget, '() => io', ['FILEIO_MOCK_INTERNAL']);
    // Experiments, not adopted remedies: canonical leaf vs public mock targets.
    vitest('vitest-leaf-partial', privateTarget, '() => io');
    vitest('vitest-leaf-spread', privateTarget, 'async importOriginal => ({ ...await importOriginal(), ...io })');
    vitest('vitest-public-mock-repeated-red', publicTarget, '() => io', ['FILEIO_MOCK_INTERNAL']);
    vitest('vitest-leaf-restored', privateTarget, '() => io');
    outcome = { passed: true, records, versions: { node: process.version, vitest: version('vitest'), vite: version('vite'), ...deps }, runtimeInputs, originalSha256: sha(original), exportedNames: names };
  } catch (error) {
    outcome = { passed: false, error: error.message, records, runtimeInputs, originalSha256: sha(original) };
  }
  fs.writeFileSync(path.join(runRoot, 'outcome.json'), JSON.stringify(outcome, null, 2));
  process.exitCode = outcome.passed ? 0 : 1;
} else {
  assert.ok(process.argv.length === 2 || process.argv.length === 3 && selectedMode, 'Choose no argument or selected');
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-fileio-identity-')));
  const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), NODE_BINARY: fs.realpathSync(process.execPath) };
  const args = [...Object.entries(params).flatMap(([key, value]) => ['-D', `${key}=${value}`]), '-f', profile, process.execPath, self, '--worker', ...(selectedMode ? ['selected'] : [])];
  const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
  const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
  const output = path.join(runRoot, 'outcome.json');
  const outcome = fs.existsSync(output) ? JSON.parse(clean(fs.readFileSync(output, 'utf8'))) : null;
  const inputs = [self, config, profile, path.join(testRoot, 'tooling/census.mjs'), ...templates.map(t => path.join(testRoot, t)), path.join(root, originalPath)].map(p => ({ name: path.relative(root, p), sha256: sha(fs.readFileSync(p)) }));
  if (selectedMode) inputs.push({ name: path.relative(root, selectedSpecPath), sha256: sha(fs.readFileSync(selectedSpecPath)) });
  const toolchainInputs = [
    'node_modules/vitest/package.json', 'node_modules/vitest/vitest.mjs',
    'node_modules/vite/package.json', 'node_modules/@vitest/mocker/package.json',
    'node_modules/@vitest/runner/package.json',
    'backend/node_modules/axios/package.json', 'backend/node_modules/js-yaml/package.json',
  ].map(name => ({ name, sha256: sha(fs.readFileSync(path.join(toolRoot, name))) }));
  const report = { schema: 'daylight.preimplementation.fileio-identity/v1', id: 'RUN-FILEIO-IDENTITY-' + Date.now(), pack: 'fileio-identity', capturedAt: new Date().toISOString(), baseline: JSON.parse(fs.readFileSync(path.join(packet, 'baseline.json'))).revision, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-fileio-identity.mjs', inputBase: 'repository root', inputs, exitCode: r.status, signal: r.signal, outcome, stdout: clean(r.stdout), stderr: clean(r.stderr), limits: ['Manual links and explicit 77-name facade are experimental; no npm adoption, approved public export population or original consumer-suite claim', 'Unchanged FileIO runtime bytes, synthetic readers and YAML only; no actual migration/candidate/composition/controller', 'Public and private namespace objects are intentionally distinct; exported bindings and cache must remain single-instance', 'Canonical-private mock is a test mechanism, not permission for cross-owner production private imports', 'OS denies network and all writes outside task root; only this Node binary may execute; no installed dependencies changed'] };
  if (selectedMode) {
    report.pack = 'fileio-identity-selected';
    report.command += ' selected';
    report.limits[0] = 'Selected 73-name facade source bytes in a manually linked disposable fixture; not full package adoption or original consumer-suite candidate parity';
  }
  const name = report.pack + '-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  report.toolchainInputs = toolchainInputs;
  report.limits.push('Installed dependency/runner manifests and CLI are fingerprinted; not complete transitive installed-byte or clean-install provenance');
  fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: outcome?.passed, steps: outcome?.records.map(s => ({ label: s.label, exitCode: s.exitCode, populationMatches: s.populationMatches })), error: outcome?.error, stderr: clean(r.stderr) }) + '\n');
  if (r.status !== 0 || !outcome?.passed) process.exitCode = 1;
}
