/** Execute unchanged, inspected FileIO consumer suites inside the existing OS sandbox. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
assert.equal(process.argv.length, 2, 'No test selection or runtime override arguments accepted');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const manifest = path.join(testRoot, 'fixtures/fileio-consumers.json');
const selected = JSON.parse(fs.readFileSync(manifest));
assert.equal(selected.files.length, 6);
const expectedCases = selected.files.reduce((sum, f) => sum + f.expectedCases, 0);
assert.equal(expectedCases, 36);
const graph = JSON.parse(fs.readFileSync(path.join(packet, 'dependency-ledger.json')));
const ledger = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
const outgoing = new Map();
for (const edge of graph.edges) {
  if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
  outgoing.get(edge.from).push(edge);
}
const closure = new Set(selected.files.map(f => f.path)), queue = [...closure];
for (let cursor = 0; cursor < queue.length; cursor++) {
  for (const edge of outgoing.get(queue[cursor]) || []) {
    assert.ok(!edge.kind.startsWith('unresolved'), 'Unreviewed unresolved source import: ' + edge.id);
    if (edge.kind !== 'source' || closure.has(edge.target)) continue;
    assert.ok(!edge.target.startsWith('backend/src/5_composition/') && !['backend/index.js', 'backend/src/app.mjs', 'backend/src/0_system/config/index.mjs'].includes(edge.target), 'Unsafe closure target: ' + edge.target);
    closure.add(edge.target); queue.push(edge.target);
  }
}
for (const file of closure) assert.equal(sha(fs.readFileSync(path.join(root, file))), ledger.files.find(f => f.path === file)?.sha256, 'Source freshness: ' + file);
const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-fileio-consumers-')));
const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), ROOT_MANIFEST: path.join(toolRoot, 'package.json'), BACKEND_MANIFEST: path.join(toolRoot, 'backend/package.json'), FRONTEND_MANIFEST: path.join(toolRoot, 'frontend/package.json') };
const profile = path.join(testRoot, 'configs/node.sbp'), config = path.join(testRoot, 'configs/fileio-consumers.mjs'), loader = path.join(testRoot, 'drivers/baseline-loader.mjs');
const output = path.join(runRoot, 'result.json');
const args = [...Object.entries(params).flatMap(([key, value]) => ['-D', `${key}=${value}`]), '-f', profile, process.execPath, '--experimental-loader', loader, path.join(toolRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=json', '--outputFile=' + output, '--config', config, '--configLoader', 'native'];
const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_RUN_ROOT: runRoot, PRE_TOOLCHAIN_ROOT: toolRoot, TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
const outcome = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
const population = selected.files.map(file => {
  const result = outcome?.testResults?.find(s => s.name === path.join(root, file.path));
  const assertions = result?.assertionResults || [];
  return { ...file, actualCases: assertions.length, passed: assertions.filter(a => a.status === 'passed').length, failed: assertions.filter(a => a.status === 'failed').length, matched: assertions.length === file.expectedCases && assertions.every(a => a.status === 'passed') };
});
const populationMatches = outcome?.numTotalTests === expectedCases && outcome.numPassedTests === expectedCases && outcome.numFailedTests === 0 && outcome.testResults?.length === selected.files.length && population.every(p => p.matched);
const inputPaths = [fileURLToPath(import.meta.url), manifest, config, profile, loader, path.join(testRoot, 'tooling/census.mjs'), path.join(packet, 'dependency-ledger.json'), ...[...closure].map(p => path.join(root, p))];
const inputs = inputPaths.map(p => ({ name: path.relative(root, p), sha256: sha(fs.readFileSync(p)) }));
const report = { schema: 'daylight.preimplementation.fileio-consumers/v1', id: 'RUN-FILEIO-CONSUMERS-' + Date.now(), pack: 'fileio-consumers', capturedAt: new Date().toISOString(), baseline: ledger.baseline, inputBase: 'repository root', inputs, node: process.version, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-fileio-consumers.mjs', exitCode: r.status, signal: r.signal, populationMatches, population, sourceClosure: [...closure].sort(), outcome: outcome ? JSON.parse(clean(JSON.stringify(outcome))) : null, stdout: clean(r.stdout), stderr: clean(r.stderr), limits: ['Six unchanged original suites, not all 22 mock sites or all FileIO consumer contracts', 'Existing preparation loader bridges original installed dependency scopes; not native relocated package resolution', 'Only Workout suite uses actual task-temporary YAML/disk; other five suites keep their original in-memory/partial mock behavior', 'Original adapter raw path/config/port issues are baseline constraints, not fixed or approved by passing behavior assertions', 'No controller, provider, private data, network or repository writes from the sandboxed runner'] };
const name = 'fileio-consumers-' + new Date().toISOString().replaceAll(':', '-') + '.json';
fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, populationMatches, files: population.map(p => ({ path: p.path, passed: p.passed, failed: p.failed, expected: p.expectedCases })), stdout: populationMatches ? undefined : clean(r.stdout), stderr: populationMatches ? undefined : clean(r.stderr) }) + '\n');
if (r.status !== 0 || !populationMatches) process.exitCode = 1;
