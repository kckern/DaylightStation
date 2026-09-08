/** Run inspected original consumer suites in disposable old/new rendering layouts. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const self = fileURLToPath(import.meta.url), testRoot = path.join(root, 'tests/preimplementation/application-modules');
const profile = path.join(testRoot, 'configs/package-install.sbp'), config = path.join(testRoot, 'configs/rendering-consumers.mjs');
const specNames = ['rendering-consumer-review.json', 'rendering-boundary.json'];
const [spec, rendering] = specNames.map(f => JSON.parse(fs.readFileSync(path.join(packet, f))));
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const require = createRequire(path.join(toolRoot, 'package.json')), { parse } = require('@babel/parser');
assert.equal(spec.files.length, 48); assert.equal(spec.suites.length, 4); assert.equal(spec.suites.reduce((n, s) => n + s.expected, 0), 23);
const originals = new Map(), candidates = new Map();
for (const f of spec.files) {
  const source = fs.readFileSync(path.join(root, f.path), 'utf8'); assert.equal(sha(source), f.originalSha256);
  let text = source, last = source.length;
  for (const e of [...f.edits].sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= last); assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); last = e.start;
  }
  assert.equal(sha(text), f.proposedSha256); parse(text, { sourceType: 'module' });
  originals.set(f.path, source); candidates.set(f.destination, text);
}
for (const s of spec.suites) {
  const start = text => parse(text, { sourceType: 'module' }).program.body.find(n => n.type === 'ExpressionStatement' && ['describe', 'test'].includes(n.expression.callee?.name)).start;
  const before = originals.get(s.path), after = candidates.get(s.path);
  assert.equal(sha(before.slice(start(before))), s.unchangedSuiteBodySha256);
  assert.equal(after.slice(start(after)), before.slice(start(before)));
}
const list = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => {
  assert.ok(!e.isSymbolicLink(), 'Unexpected native package symlink'); const file = path.join(directory, e.name);
  if (e.isDirectory()) return list(file); assert.ok(e.isFile()); return [file];
}).sort();
const nativeFiles = list(path.join(toolRoot, 'backend/node_modules/canvas')); assert.equal(nativeFiles.length, 95);
const runnerFiles = ['', 'backend/'].flatMap(scope => ['vitest/package.json', 'vitest/vitest.mjs', 'vitest/dist/index.js', 'vitest/index.cjs', 'vite/package.json', '@vitest/runner/package.json', '@vitest/mocker/package.json'].map(p => path.join(toolRoot, scope + 'node_modules/' + p)));
const externalFiles = spec.externalEdges.filter(e => e.kind === 'package' && !['vitest', 'canvas'].includes(e.package.name)).flatMap(e => [e.target, e.package.instance + '/package.json']).map(p => path.join(toolRoot, p));
const toolchainInputs = [...new Set([...nativeFiles, ...runnerFiles, ...externalFiles, require.resolve('@babel/parser'), require.resolve('@babel/parser/package.json')])].sort().map(f => ({ name: path.relative(toolRoot, f), sha256: sha(fs.readFileSync(f)) }));
assert.equal(toolchainInputs.length, 120);
for (const [file, expected] of [['node_modules/vitest/package.json', '4.1.10'], ['backend/node_modules/vitest/package.json', '4.0.18'], ['backend/node_modules/canvas/package.json', '3.1.0'], ['node_modules/pdfkit/package.json', '0.18.0'], ['node_modules/mathjax-full/package.json', '3.2.2']]) assert.equal(JSON.parse(fs.readFileSync(path.join(toolRoot, file))).version, expected);
const inputPaths = [...new Set([self, config, profile, path.join(testRoot, 'tooling/census.mjs'), ...specNames.map(f => path.join(packet, f)), ...spec.inputs.map(f => path.join(root, f.path))])];
const inputs = inputPaths.map(f => ({ name: path.relative(root, f), sha256: sha(fs.readFileSync(f)) }));
if (process.argv[2] === '--worker') {
  assert.equal(process.argv.length, 3);
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT); assert.ok(path.basename(runRoot).startsWith('daylight-rendering-consumers-'));
  function write(variant, file, value) {
    const target = path.resolve(runRoot, variant, file); assert.ok(target.startsWith(path.join(runRoot, variant) + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
    fs.chmodSync(target, 0o644);
  }
  function link(variant, file, target) {
    const destination = path.join(runRoot, variant, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.symlinkSync(target, destination, 'dir');
  }
  for (const variant of ['baseline', 'candidate']) {
    const candidate = variant === 'candidate', base = path.join(runRoot, variant);
    for (const [file, text] of candidate ? candidates : originals) write(variant, file, text);
    write(variant, 'package.json', { name: 'rendering-consumers-' + variant, private: true, imports: spec.packageScope.rootImports });
    write(variant, 'backend/package.json', { name: 'rendering-consumers-backend', private: true, type: 'module', imports: spec.packageScope.backendImports });
    for (const f of rendering.assetMoves) { const bytes = fs.readFileSync(path.join(root, f.path)); assert.equal(sha(bytes), f.sha256); write(variant, candidate ? f.destination : f.path, bytes); }
    for (const [file, authority] of [['node_modules/vitest', 'node_modules/vitest'], ['backend/node_modules/vitest', 'backend/node_modules/vitest'], ['backend/node_modules/canvas', 'backend/node_modules/canvas'], ['node_modules/pdfkit', 'node_modules/pdfkit'], ['node_modules/mathjax-full', 'node_modules/mathjax-full']]) link(variant, file, path.join(toolRoot, authority));
    if (candidate) {
      for (const f of rendering.newFiles) { assert.equal(sha(f.sourceText), f.sha256); write(variant, f.path, f.sourceText); }
      write(variant, 'platform/public/package.json', { name: '@daylight/platform', version: '0.0.0', private: true, type: 'module', ...rendering.packageFragments.public });
      write(variant, 'platform/server/package.json', { name: '@daylight-internal/platform--server', version: '0.0.0', private: true, type: 'module', ...rendering.packageFragments.server });
      link(variant, 'node_modules/@daylight/platform', path.join(base, 'platform/public'));
      link(variant, 'node_modules/@daylight-internal/platform--server', path.join(base, 'platform/server'));
      link(variant, 'platform/server/node_modules/canvas', path.join(toolRoot, 'backend/node_modules/canvas'));
      for (const f of rendering.files) assert.equal(fs.existsSync(path.join(base, f.path)), false, 'Old helper body retained');
      assert.equal(fs.existsSync(path.join(base, 'backend/assets/fonts')), false, 'Old bundled font root retained');
    }
  }
  function snapshot() {
    const files = [], links = [];
    function visit(directory) {
      for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
        if (e.name.startsWith('vite-cache-')) continue;
        const full = path.join(directory, e.name), file = path.relative(runRoot, full);
        if (e.isSymbolicLink()) links.push({ path: file, target: fs.realpathSync(full) });
        else if (e.isDirectory()) visit(full);
        else { assert.ok(e.isFile()); files.push({ path: file, sha256: sha(fs.readFileSync(full)), mode: fs.statSync(full).mode & 0o777 }); }
      }
    }
    for (const variant of ['baseline', 'candidate']) visit(path.join(runRoot, variant));
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), links: links.sort((a, b) => a.path.localeCompare(b.path)) };
  }
  const records = [];
  function nodeSuite(variant, suite) {
    // Executing this node:test file directly avoids test-runner subprocess discovery.
    const r = spawnSync(process.execPath, [suite.path], { cwd: path.join(runRoot, variant), env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const titles = [...r.stdout.matchAll(/^ok \d+ - ([^\n]+)$/gm)].map(m => m[1]);
    const counters = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(k => [k, Number(r.stdout.match(new RegExp('^# ' + k + ' (\\d+)$', 'm'))?.[1] ?? NaN)]));
    const populationMatches = JSON.stringify(titles) === JSON.stringify(suite.cases.map(c => c.title)) && counters.tests === 2 && counters.pass === 2 && ['fail', 'cancelled', 'skipped', 'todo'].every(k => counters[k] === 0);
    records.push({ variant, kind: 'node', scope: 'backend', exitCode: r.status, signal: r.signal, populationMatches, cases: titles, counters, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, 0, r.stderr); assert.ok(populationMatches, 'Wrong Fitness original population: ' + r.stdout); assert.equal(r.stderr, '');
  }
  function vitestSuites(variant, scope) {
    const selected = spec.suites.filter(s => s.runner === 'vitest' && s.runtimeScope === scope);
    const output = path.join(runRoot, variant + '-' + scope + '.json');
    const cli = path.join(toolRoot, scope === 'backend' ? 'backend/node_modules/vitest/vitest.mjs' : 'node_modules/vitest/vitest.mjs');
    const r = spawnSync(process.execPath, [cli, 'run', '--config', config, '--configLoader', 'native', '--reporter=json', '--outputFile=' + output],
      { cwd: path.join(runRoot, variant), env: { ...process.env, PRE_RENDERING_VARIANT: variant, PRE_RENDERING_SCOPE: scope }, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
    const outcome = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : null;
    const population = selected.map(s => {
      const test = outcome?.testResults?.find(t => t.name === path.join(runRoot, variant, s.path));
      const names = test?.assertionResults.map(({ title, fullName, ancestorTitles }) => ({ title, ancestorTitles, fullName }));
      return { path: s.path, expected: s.expected, cases: names, namesMatch: JSON.stringify(names) === JSON.stringify(s.cases), allPassed: test?.status === 'passed' && test.assertionResults.length === s.expected && test.assertionResults.every(a => a.status === 'passed' && a.failureMessages.length === 0) };
    });
    const expected = selected.reduce((n, s) => n + s.expected, 0);
    const populationMatches = outcome?.success === true && outcome.numTotalTests === expected && outcome.numPassedTests === expected && outcome.numFailedTests === 0 && outcome.numPendingTests === 0 && outcome.numTodoTests === 0 && outcome.testResults.length === selected.length && population.every(p => p.namesMatch && p.allPassed);
    records.push({ variant, kind: 'vitest', scope, exitCode: r.status, signal: r.signal, populationMatches, population, outcome, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, 0, r.stderr); assert.ok(populationMatches, 'Wrong original ' + scope + ' population'); assert.equal(r.stderr, '');
  }
  let outcome;
  try {
    const initialGraph = snapshot(); assert.equal(initialGraph.files.length, 125); assert.equal(initialGraph.links.length, 13);
    for (const variant of ['baseline', 'candidate']) { nodeSuite(variant, spec.suites[0]); vitestSuites(variant, 'root'); vitestSuites(variant, 'backend'); }
    const finalGraph = snapshot(); assert.deepEqual(finalGraph, initialGraph);
    for (const i of inputs) assert.equal(sha(fs.readFileSync(path.join(root, i.name))), i.sha256);
    for (const i of toolchainInputs) assert.equal(sha(fs.readFileSync(path.join(toolRoot, i.name))), i.sha256);
    outcome = { passed: true, records, initialGraph, finalGraph, files: spec.files, suites: spec.suites, sourceEdits: 20, assets: rendering.assetMoves, packageScope: spec.packageScope, node: process.version };
  } catch (error) { outcome = { passed: false, records, error: error.message }; }
  fs.writeFileSync(path.join(runRoot, 'outcome.json'), JSON.stringify(outcome, null, 2)); if (!outcome.passed) process.exitCode = 1;
} else {
  assert.equal(process.argv.length, 2);
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-rendering-consumers-')));
  const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), NODE_BINARY: fs.realpathSync(process.execPath) };
  const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '-f', profile, process.execPath, self, '--worker'];
  const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024,
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
  const clean = text => String(text || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
  const output = path.join(runRoot, 'outcome.json'), outcome = fs.existsSync(output) ? JSON.parse(clean(fs.readFileSync(output, 'utf8'))) : null;
  const report = { schema: 'daylight.preimplementation.rendering-consumers-run/v1', id: 'RUN-RENDERING-CONSUMERS-' + Date.now(), pack: 'rendering-consumers', capturedAt: new Date().toISOString(), baseline: spec.baseline,
    inputBase: 'repository root', inputs, toolchainInputs, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-rendering-consumers.mjs', exitCode: r.status, signal: r.signal, outcome, stdout: clean(r.stdout), stderr: clean(r.stderr),
    limits: ['Four original suites, 23 named cases per layout, separate original Node/root Vitest 4.1.10/backend Vitest 4.0.18 processes; no root setup, preparation loader or source aliases',
      '48 source/test files and 20 pre-specified edits, three helper moves, five new source files and nine asset moves in disposable copies. Root/backend original import maps remain for unmoved consumers. Three utility changes remain pending; not the full combined migration',
      'Original assertion/helper bodies preserved. Native canvas 3.1.0, pdfkit 0.18.0 and MathJax 3.2.2 use installed packages through task-local links, not npm installation, lock adoption or Linux image proof',
      '120 explicit native/direct runtime/parser/runner fingerprints, not full transitive JavaScript/native/OS attestation. Original tests preserve their assertion coverage; passing tests alone do not prove full byte parity, font lifecycle or new negative sensitivity',
      '125 fixture files and thirteen links unchanged after execution, with old helper/font roots absent from candidate. Network and outside-task writes denied; no provider, private data, physical devices or controller',
      '23 original cases are recorded separately from the 345-case preparation catalog and eleven product red/restored pairs; nineteen remaining rendering suites and fifty-nine transitive tests have explicit impact dispositions'] };
  const name = 'rendering-consumers-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: outcome?.passed, error: outcome?.error, records: outcome?.records.map(r => ({ variant: r.variant, kind: r.kind, scope: r.scope, exitCode: r.exitCode, populationMatches: r.populationMatches })), stderr: clean(r.stderr) }) + '\n');
  if (r.status !== 0 || !outcome?.passed) process.exitCode = 1;
}
