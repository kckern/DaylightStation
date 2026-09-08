/** Rendering/font selected-package experiment; writes only evidence and task-owned copies. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const self = fileURLToPath(import.meta.url), testRoot = path.join(root, 'tests/preimplementation/application-modules');
const profile = path.join(testRoot, 'configs/package-install.sbp');
const template = path.join(testRoot, 'fixtures/rendering-identity.mjs');
const selectionPath = path.join(testRoot, 'fixtures/rendering-identity.json');
const config = path.join(testRoot, 'configs/rendering-originals.mjs');
const selection = JSON.parse(fs.readFileSync(selectionPath));
const specPaths = ['rendering-boundary.json', 'combined-boundary-review.json'].map(f => path.join(packet, f));
const [spec, combined] = specPaths.map(f => JSON.parse(fs.readFileSync(f)));
assert.equal(spec.files.length, 3); assert.equal(spec.newFiles.length, 5); assert.equal(spec.assetMoves.length, 9);
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const require = createRequire(path.join(toolRoot, 'package.json')), { parse } = require('@babel/parser');
const runtimeRoots = ['backend/node_modules/canvas', 'node_modules/canvas'];
function enumerate(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'Unreviewed symlink: ' + e.name);
    const file = path.join(directory, e.name);
    if (e.isDirectory()) return enumerate(file);
    assert.ok(e.isFile(), 'Unreviewed special file'); return [file];
  }).sort();
}
const nativeInputs = runtimeRoots.flatMap(p => enumerate(path.join(toolRoot, p)));
assert.equal(nativeInputs.length, 203);
assert.equal(JSON.parse(fs.readFileSync(path.join(toolRoot, runtimeRoots[0], 'package.json'))).version, '3.1.0');
assert.equal(JSON.parse(fs.readFileSync(path.join(toolRoot, runtimeRoots[1], 'package.json'))).version, '3.2.1');
const runnerInputs = ['node_modules/vitest/package.json', 'node_modules/vitest/vitest.mjs', 'node_modules/vite/package.json', 'node_modules/@vitest/mocker/package.json', 'node_modules/@vitest/runner/package.json'].map(f => path.join(toolRoot, f));
const toolchainInputs = [...nativeInputs, require.resolve('@babel/parser'), require.resolve('@babel/parser/package.json'), ...runnerInputs].map(f => ({ name: path.relative(toolRoot, f), sha256: sha(fs.readFileSync(f)) }));
const projectManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(projectManifest.imports['#rendering/*'], './backend/src/1_rendering/*');
function project(file) {
  const original = fs.readFileSync(path.join(root, file), 'utf8'), joint = combined.files.find(f => f.path === file);
  assert.equal(sha(original), joint?.sourceSha256);
  const edits = spec.edits.filter(e => e.path === file); assert.ok(edits.length);
  let text = original, last = text.length;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= last); assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); last = e.start;
  }
  parse(text, { sourceType: 'module' }); assert.equal(sha(text), joint.plannedSha256);
  return { original, text, path: file, originalSha256: sha(original), proposedSha256: sha(text), edits };
}
const sources = spec.files.map(f => ({ ...project(f.path), destination: f.destination }));
assert.equal(sources.reduce((n, f) => n + f.edits.length, 0), 6);
const originals = selection.originals.map(f => {
  const record = project(f.path), imports = s => parse(s, { sourceType: 'module' }).program.body.filter(n => n.type === 'ImportDeclaration');
  const before = imports(record.original), after = imports(record.text);
  assert.equal(record.edits.length, 1); assert.equal(before.length, 2); assert.equal(after.length, 2);
  const edit = record.edits[0]; assert.ok(edit.start >= before[1].start && edit.end <= before[1].end);
  const bindings = nodes => nodes.flatMap(n => n.specifiers.map(s => [s.local.name, s.imported?.name || s.type]));
  assert.deepEqual(bindings(before), bindings(after));
  const body = record.original.slice(before.at(-1).end); assert.equal(record.text.slice(after.at(-1).end), body);
  assert.equal(record.original.slice(0, before[1].start), record.text.slice(0, after[1].start));
  const calls = parse(record.original, { sourceType: 'module' }).program.body[2];
  assert.equal(calls.expression.callee.name, 'describe'); assert.equal(calls.expression.arguments[0].value, f.suite);
  const titles = calls.expression.arguments[1].body.body.filter(n => n.type === 'ExpressionStatement' && n.expression.callee?.name === 'it').map(n => n.expression.arguments[0].value);
  assert.deepEqual(titles, f.titles);
  return { ...record, unchangedBodySha256: sha(body), suite: f.suite, titles: f.titles };
});
for (const f of spec.newFiles) { assert.equal(sha(f.sourceText), f.sha256); parse(f.sourceText, { sourceType: 'module' }); }
for (const f of spec.assetMoves) {
  const name = path.join(root, f.path); assert.equal(sha(fs.readFileSync(name)), f.sha256);
  assert.equal(fs.statSync(name).mode & 0o777, 0o644); assert.equal(fs.statSync(name).size, f.bytes);
}
const repoInputs = [...new Set([self, profile, template, selectionPath, config, path.join(testRoot, 'tooling/census.mjs'), ...specPaths, path.join(root, 'package.json'), ...spec.inputs.map(f => path.join(root, f.path))])];
const inputs = repoInputs.map(f => ({ name: path.relative(root, f), sha256: sha(fs.readFileSync(f)) }));
if (process.argv[2] === '--worker') {
  assert.equal(process.argv.length, 3);
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT); assert.ok(path.basename(runRoot).startsWith('daylight-rendering-identity-'));
  const graph = {};
  const write = (variant, name, value) => {
    const target = path.resolve(runRoot, variant, name); assert.ok(target.startsWith(path.join(runRoot, variant) + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n');
  };
  const link = (variant, name, destination) => {
    const target = path.join(runRoot, variant, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.symlinkSync(destination, target, 'dir');
  };
  for (const variant of ['baseline', 'candidate']) {
    const base = path.join(runRoot, variant), candidate = variant === 'candidate';
    const facet = candidate ? 'platform/server' : 'backend', fontRoot = candidate ? 'platform/server/assets/fonts' : 'backend/assets/fonts';
    fs.mkdirSync(path.join(base, 'unrelated-cwd'), { recursive: true });
    write(variant, 'package.json', { name: 'daylight-rendering-' + variant, private: true, type: 'module',
      ...(candidate ? { workspaces: ['platform/public', 'platform/server'] } : { imports: { '#rendering/*': projectManifest.imports['#rendering/*'] } }) });
    for (const f of sources) write(variant, candidate ? f.destination : f.path, candidate ? f.text : f.original);
    for (const f of originals) write(variant, f.path, candidate ? f.text : f.original);
    for (const f of spec.assetMoves) {
      const name = candidate ? f.destination : f.path; write(variant, name, fs.readFileSync(path.join(root, f.path))); fs.chmodSync(path.join(base, name), 0o644);
    }
    if (candidate) {
      for (const f of spec.newFiles) write(variant, f.path, f.sourceText);
      write(variant, 'platform/public/package.json', { name: '@daylight/platform', private: true, version: '0.0.0', type: 'module', ...spec.packageFragments.public });
      write(variant, 'platform/server/package.json', { name: '@daylight-internal/platform--server', private: true, version: '0.0.0', type: 'module', ...spec.packageFragments.server });
      link(variant, 'node_modules/@daylight/platform', path.join(base, 'platform/public'));
      link(variant, 'node_modules/@daylight-internal/platform--server', path.join(base, 'platform/server'));
    }
    link(variant, facet + '/node_modules/canvas', path.join(toolRoot, runtimeRoots[0]));
    link(variant, 'node_modules/vitest', path.join(toolRoot, 'node_modules/vitest'));
    const regular = spec.assetMoves.find(f => f.path.endsWith('/RobotoCondensed-Regular.ttf'));
    write(variant, 'explicit-fonts/roboto-condensed/RobotoCondensed-Regular.ttf', fs.readFileSync(path.join(root, regular.path)));
    write(variant, 'probe.mjs', fs.readFileSync(template, 'utf8'));
    write(variant, 'expectation.json', { variant, probeIds: selection.probeIds, fontRoot: path.join(base, fontRoot), overrideRoot: path.join(base, 'explicit-fonts'),
      canvasEntry: fs.realpathSync(path.join(toolRoot, runtimeRoots[0], 'index.js')),
      entries: candidate ? spec.facades.map(f => ({ entry: f.entry, target: f.target, names: f.names })) : sources.map((f, i) => ({ entry: './' + f.path, target: f.path, names: spec.facades[i].names })),
      assets: spec.assetMoves.map(f => ({ relative: f.path.replace('backend/assets/fonts/', ''), sha256: f.sha256, bytes: f.bytes })) });
    graph[variant] = { base, facet, fontRoot };
  }
  function snapshot() {
    const files = [], links = [];
    for (const variant of ['baseline', 'candidate']) {
      const base = graph[variant].base;
      function visit(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.name === 'vite-cache') continue;
          const name = path.join(dir, e.name), relative = path.relative(runRoot, name);
          if (e.isSymbolicLink()) links.push({ path: relative, target: fs.realpathSync(name) });
          else if (e.isDirectory()) visit(name);
          else { assert.ok(e.isFile()); files.push({ path: relative, sha256: sha(fs.readFileSync(name)), mode: fs.statSync(name).mode & 0o777 }); }
        }
      }
      visit(base);
      assert.equal(fs.realpathSync(path.join(base, graph[variant].facet, 'node_modules/canvas')), fs.realpathSync(path.join(toolRoot, runtimeRoots[0])));
    }
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)), links: links.sort((a, b) => a.path.localeCompare(b.path)) };
  }
  const records = [];
  function probe(variant, label, mutation = null) {
    const r = spawnSync(process.execPath, ['probe.mjs'], { cwd: graph[variant].base, env: process.env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    let result = null; try { result = JSON.parse(r.stdout); } catch { /* Missing result fails population; never a valid red. */ }
    const populationMatches = result?.count === 10 && JSON.stringify(result.results?.map(p => p.id)) === JSON.stringify(selection.probeIds);
    records.push({ label, variant, kind: 'probe', mutation, exitCode: r.status, populationMatches, result, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, mutation ? 1 : 0, label + ': ' + r.stderr); assert.ok(populationMatches, label + ': missing probes');
    assert.deepEqual(result.failedIds, mutation ? selection.mutations[mutation] : [], label + ': wrong failed probes');
    assert.equal(r.stderr, '', label + ': unexpected diagnostics'); return result;
  }
  function originalTests(variant, label) {
    const output = path.join(runRoot, label + '.json');
    const r = spawnSync(process.execPath, [path.join(toolRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--configLoader', 'native', '--reporter=json', '--outputFile=' + output],
      { cwd: graph[variant].base, env: { ...process.env, PRE_RENDERING_VARIANT: variant }, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    const result = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output)) : null;
    const population = originals.map(f => {
      const suite = result?.testResults.find(s => s.name === path.join(graph[variant].base, f.path));
      const names = suite?.assertionResults.map(a => ({ title: a.title, ancestorTitles: a.ancestorTitles, fullName: a.fullName }));
      const expected = f.titles.map(title => ({ title, ancestorTitles: [f.suite], fullName: f.suite + ' ' + title }));
      return { path: f.path, assertions: names, passed: suite?.status === 'passed' && suite.assertionResults.length === 5 && suite.assertionResults.every(a => a.status === 'passed' && a.failureMessages.length === 0), namesMatch: JSON.stringify(names) === JSON.stringify(expected) };
    });
    const populationMatches = result?.success === true && result.numTotalTests === 10 && result.numPassedTests === 10 && result.numFailedTests === 0 && result.numPendingTests === 0 && result.numTodoTests === 0 && result.testResults.length === 2 && population.every(p => p.passed && p.namesMatch);
    records.push({ label, variant, kind: 'originals', exitCode: r.status, populationMatches, population, result, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, 0, label + ': ' + r.stderr); assert.ok(populationMatches, label + ': wrong original population'); assert.equal(r.stderr, '');
  }
  let outcome;
  try {
    const initialGraph = snapshot();
    const baseline = probe('baseline', 'baseline-native'); originalTests('baseline', 'baseline-originals');
    const candidate = probe('candidate', 'candidate-native'); originalTests('candidate', 'candidate-originals');
    const drawing = r => r.results.find(p => p.id === 'REND-DRAWING').observation;
    assert.deepEqual(drawing(candidate), drawing(baseline), 'Before/after native metrics, wrapping, pixels, rotation and PNG differ');
    const layout = spec.facades[1], copy = layout.target.replace('.mjs', '-copy.mjs');
    write('candidate', copy, sources[1].text);
    const relative = path.posix.relative(path.posix.dirname(layout.path), copy);
    write('candidate', layout.path, `export { ${layout.names.join(', ')} } from '${relative}';\n`);
    probe('candidate', 'duplicate-layout-red', 'duplicate-layout');
    write('candidate', layout.path, layout.sourceText); fs.unlinkSync(path.join(graph.candidate.base, copy)); probe('candidate', 'layout-restored');
    const locator = spec.newFiles.find(f => f.path === spec.facades[3].target);
    assert.equal(locator.sourceText.split('../../assets/fonts').length, 2);
    write('candidate', locator.path, locator.sourceText.replace('../../assets/fonts', '../../assets/absent-fonts'));
    probe('candidate', 'wrong-font-root-red', 'wrong-font-root'); write('candidate', locator.path, locator.sourceText); probe('candidate', 'font-root-restored');
    for (const [mutation, suffix, label] of [['missing-font', '/RobotoCondensed-Regular.ttf', 'font'], ['missing-notice', '/kongtext/LICENSE.txt', 'notice']]) {
      const asset = spec.assetMoves.find(f => f.destination.endsWith(suffix)); assert.ok(asset);
      const source = path.join(graph.candidate.base, asset.destination), held = path.join(runRoot, 'held-' + label);
      fs.renameSync(source, held); probe('candidate', mutation + '-red', mutation); fs.renameSync(held, source); probe('candidate', label + '-restored');
    }
    const canvasLink = path.join(graph.candidate.base, 'platform/server/node_modules/canvas'); assert.ok(fs.lstatSync(canvasLink).isSymbolicLink());
    fs.unlinkSync(canvasLink); fs.symlinkSync(path.join(toolRoot, runtimeRoots[1]), canvasLink, 'dir'); probe('candidate', 'root-canvas-fallback-red', 'root-canvas-fallback');
    fs.unlinkSync(canvasLink); fs.symlinkSync(path.join(toolRoot, runtimeRoots[0]), canvasLink, 'dir');
    const restored = probe('candidate', 'native-final-restored'); originalTests('candidate', 'originals-final-restored');
    assert.deepEqual(drawing(restored), drawing(baseline));
    const restoredGraph = snapshot(); assert.deepEqual(restoredGraph, initialGraph);
    for (const input of toolchainInputs) assert.equal(sha(fs.readFileSync(path.join(toolRoot, input.name))), input.sha256);
    for (const input of inputs) assert.equal(sha(fs.readFileSync(path.join(root, input.name))), input.sha256);
    outcome = { passed: true, records, initialGraph, restoredGraph, drawingParity: drawing(baseline),
      sourcePlan: sources.map(({ original, text, ...record }) => record), originalTestPlan: originals.map(({ original, text, ...record }) => record),
      assetMoves: spec.assetMoves, publicExports: spec.packageFragments.public.exports, privateExports: spec.packageFragments.server.exports,
      installedCanvas: '3.1.0', declaredCanvas: spec.packageFragments.server.dependencies.canvas, dependencyGate: spec.dependencyGate,
      node: process.version, packageMechanism: 'manual links to selected installed native dependency, not npm installation' };
  } catch (error) { outcome = { passed: false, records, error: error.message }; }
  fs.writeFileSync(path.join(runRoot, 'outcome.json'), JSON.stringify(outcome, null, 2));
  if (!outcome.passed) process.exitCode = 1;
} else {
  assert.equal(process.argv.length, 2);
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-rendering-identity-')));
  const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), NODE_BINARY: fs.realpathSync(process.execPath) };
  const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '-f', profile, process.execPath, self, '--worker'];
  const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 6 * 1024 * 1024,
    env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
  const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
  const output = path.join(runRoot, 'outcome.json'), outcome = fs.existsSync(output) ? JSON.parse(clean(fs.readFileSync(output, 'utf8'))) : null;
  const report = { schema: 'daylight.preimplementation.rendering-identity/v1', id: 'RUN-RENDERING-IDENTITY-' + Date.now(), pack: 'rendering-identity', capturedAt: new Date().toISOString(), baseline: spec.baseline,
    inputBase: 'repository root', inputs, toolchainInputs, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-rendering-identity.mjs',
    exitCode: r.status, signal: r.signal, outcome, stdout: clean(r.stdout), stderr: clean(r.stderr),
    limits: ['Three exact rendering bodies/six planned edits, one new locator/four exact facades, nine original font/notice assets, and two original test import edits in disposable old/new layouts only',
      'Installed backend canvas 3.1.0 deliberately characterizes the current backend. It does not satisfy declared ^3.2.1 or prove backend locked 3.2.3; root 3.2.1 is a controlled wrong-resolution fixture, not an upgrade decision',
      'Manual task-package links, no install/lock adoption, full workspace, browser, Linux image, controller, PDF or affected-owner renderer parity',
      'Actual native functions execute; only registerFont is wrapped to trace and delegate before the lazy ESM import, restored at process exit. Fonts are process-global; every graph probe uses a fresh process',
      '203 installed canvas files and seven parser/runner fingerprints, not full transitive JavaScript/native/system-font/OS dependency attestation',
      'Ten original named assertions run before/after/restored, plus ten probes across twelve processes and five negative/restoration controls. These are separate observations, not additions to the baseline catalog or eleven product mutation pairs',
      'Network denied and filesystem writes confined to task temporary roots. Existing product/tests/config/manifests/locks/assets unchanged; no live data/providers/devices'] };
  const name = 'rendering-identity-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: outcome?.passed, error: outcome?.error,
    records: outcome?.records.map(p => ({ label: p.label, populationMatches: p.populationMatches, failedIds: p.result?.failedIds })), stderr: clean(r.stderr) }) + '\n');
  if (r.status !== 0 || !outcome?.passed) process.exitCode = 1;
}
