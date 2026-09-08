/** Native logging identity/lifecycle fixture in a task-only OS sandbox. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const self = fileURLToPath(import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const profile = path.join(testRoot, 'configs/package-install.sbp');
const template = path.join(testRoot, 'fixtures/logging-identity.mjs');
const specPath = path.join(packet, 'logging-boundary.json');
const spec = JSON.parse(fs.readFileSync(specPath));
if (process.argv[2] === '--worker') {
  assert.equal(process.argv.length, 3);
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT);
  assert.ok(path.basename(runRoot).startsWith('daylight-logging-identity-'));
  const fixture = path.join(runRoot, 'fixture'); fs.mkdirSync(fixture);
  const write = (name, value) => {
    const target = path.resolve(fixture, name); assert.ok(target.startsWith(fixture + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  for (const file of spec.files) {
    const bytes = fs.readFileSync(path.join(root, file.path)); assert.equal(sha(bytes), file.sha256);
    write(file.destination, bytes.toString('utf8'));
  }
  for (const facade of spec.facades) { assert.equal(sha(facade.sourceText), facade.sha256); write(facade.path, facade.sourceText); }
  write('package.json', { name: 'daylight-logging-native-probe', private: true, type: 'module', workspaces: ['platform/public', 'platform/server'] });
  write('platform/public/package.json', { name: '@daylight/platform', version: '0.0.0', private: true, type: 'module', ...spec.packageFragments.public });
  write('platform/server/package.json', { name: '@daylight-internal/platform--server', version: '0.0.0', private: true, type: 'module', ...spec.packageFragments.server });
  for (const [owner, target] of [['@daylight/platform', 'platform/public'], ['@daylight-internal/platform--server', 'platform/server']]) {
    const link = path.join(fixture, 'node_modules', owner); fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(path.join(fixture, target), link, 'dir');
  }
  write('probe.mjs', fs.readFileSync(template, 'utf8'));
  const records = [];
  const run = (label, expectedExit, diagnostic = null) => {
    const r = spawnSync(process.execPath, [path.join(fixture, 'probe.mjs')], { cwd: fixture, env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    let result = null;
    if (r.status === 0) result = JSON.parse(r.stdout.trim());
    const expectedDiagnostic = !diagnostic || r.stderr.includes(diagnostic);
    records.push({ label, exitCode: r.status, expectedExit, expectedDiagnostic, result, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, expectedExit, label + ': ' + r.stderr); assert.ok(expectedDiagnostic, label + ': wrong failure');
    if (expectedExit === 0) { assert.equal(result.count, 12); assert.equal(new Set(result.ids).size, 12); assert.equal(result.passed, true); }
  };
  let outcome;
  try {
    const facade = spec.facades.find(f => f.entry.endsWith('/dispatcher'));
    run('native-initial', 0);
    const original = spec.files.find(f => f.path.endsWith('/dispatcher.mjs'));
    const duplicate = original.destination.replace('dispatcher.mjs', 'dispatcher-copy.mjs');
    write(duplicate, fs.readFileSync(path.join(root, original.path), 'utf8'));
    const relative = path.posix.relative(path.posix.dirname(facade.path), duplicate);
    write(facade.path, `export { ${facade.names.join(', ')} } from '${relative.startsWith('.') ? relative : './' + relative}';\n`);
    run('duplicate-dispatcher-red', 1, 'LOGGING-BINDING');
    write(facade.path, facade.sourceText); run('native-restored', 0);
    write(facade.path, `export * from '${facade.privateEntry}';\n`);
    run('leaked-test-exports-red', 1, 'LOGGING-PUBLIC-EXPORTS');
    write(facade.path, facade.sourceText); run('native-final-restored', 0);
    outcome = { passed: true, records, nativeNode: process.version, originalBodies: spec.files.map(f => ({ path: f.path, sha256: f.sha256 })), facadeHashes: spec.facades.map(f => ({ path: f.path, sha256: f.sha256 })) };
  } catch (error) { outcome = { passed: false, error: error.message, records }; }
  fs.writeFileSync(path.join(runRoot, 'outcome.json'), JSON.stringify(outcome, null, 2));
  process.exitCode = outcome.passed ? 0 : 1;
} else {
  assert.equal(process.argv.length, 2);
  const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-logging-identity-')));
  const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), NODE_BINARY: fs.realpathSync(process.execPath) };
  const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '-f', profile, process.execPath, self, '--worker'];
  const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 6 * 1024 * 1024, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, TMPDIR: runRoot } });
  const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
  const result = path.join(runRoot, 'outcome.json');
  const outcome = fs.existsSync(result) ? JSON.parse(clean(fs.readFileSync(result, 'utf8'))) : null;
  const inputs = [self, profile, template, specPath, path.join(testRoot, 'tooling/census.mjs'), ...spec.files.map(f => path.join(root, f.path))].map(file => ({ name: path.relative(root, file), sha256: sha(fs.readFileSync(file)) }));
  const report = { schema: 'daylight.preimplementation.logging-identity/v1', id: 'RUN-LOGGING-IDENTITY-' + Date.now(), pack: 'logging-identity', capturedAt: new Date().toISOString(), baseline: spec.baseline, inputBase: 'repository root', inputs, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-logging-identity.mjs', exitCode: r.status, signal: r.signal, outcome, stdout: clean(r.stdout), stderr: clean(r.stderr), limits: ['Exact selected facade paths/bytes and export fragments, original three runtime bodies, manual task-local package links; no full workspace install/lock/build adoption', 'Twelve original-code identity/state/transport/sampling probes plus two expected counterexamples; separate from selected baseline assertion and seven product mutation counts', 'Test entry is intentionally importable in native Node; production/test visibility still needs semantic enforcement and negative controls', 'No prep dependency loader, external packages, real sinks/providers/controller/network or private records; fixed Date and stream spies restored before child exit'] };
  const name = 'logging-identity-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: outcome?.passed, records: outcome?.records.map(x => ({ label: x.label, exitCode: x.exitCode, cases: x.result?.count })), error: outcome?.error, stderr: clean(r.stderr) }) + '\n');
  if (r.status !== 0 || !outcome?.passed) process.exitCode = 1;
}
