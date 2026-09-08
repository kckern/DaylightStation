/** Independently reconstruct selected source/asset/test plans and verify native receipts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateRenderingIdentity(run, root, packet, toolRoot) {
  try {
    const read = file => fs.readFileSync(path.join(root, file));
    const spec = JSON.parse(fs.readFileSync(path.join(packet, 'rendering-boundary.json')));
    const combined = JSON.parse(fs.readFileSync(path.join(packet, 'combined-boundary-review.json')));
    const prefix = 'tests/preimplementation/application-modules/';
    const selection = JSON.parse(read(prefix + 'fixtures/rendering-identity.json'));
    const require = createRequire(path.join(toolRoot, 'package.json')), { parse } = require('@babel/parser');
    assert.equal(run.schema, 'daylight.preimplementation.rendering-identity/v1'); assert.equal(run.pack, 'rendering-identity');
    assert.equal(run.baseline, spec.baseline); assert.equal(run.inputBase, 'repository root');
    assert.equal(run.exitCode, 0); assert.equal(run.signal, null); assert.equal(run.stderr, '');
    const o = run.outcome; assert.equal(o.passed, true); assert.equal(o.node, process.version);
    const requiredInputs = [...new Set([
      'tooling/run-rendering-identity.mjs', 'configs/package-install.sbp', 'fixtures/rendering-identity.mjs',
      'fixtures/rendering-identity.json', 'configs/rendering-originals.mjs', 'tooling/census.mjs',
    ].map(f => prefix + f).concat(['rendering-boundary.json', 'combined-boundary-review.json'].map(f => path.relative(root, path.join(packet, f))), ['package.json'], spec.inputs.map(f => f.path)))].sort();
    assert.deepEqual(run.inputs.map(f => f.name).sort(), requiredInputs);
    for (const f of run.inputs) assert.equal(sha(read(f.name)), f.sha256, 'Stale repository input ' + f.name);
    const enumerate = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      assert.ok(!e.isSymbolicLink()); const file = path.join(dir, e.name);
      return e.isDirectory() ? enumerate(file) : [path.relative(toolRoot, file)];
    });
    const runtime = ['backend/node_modules/canvas', 'node_modules/canvas'].flatMap(f => enumerate(path.join(toolRoot, f)));
    assert.equal(runtime.length, 203);
    const tools = ['node_modules/@babel/parser/lib/index.js', 'node_modules/@babel/parser/package.json', 'node_modules/vitest/package.json', 'node_modules/vitest/vitest.mjs', 'node_modules/vite/package.json', 'node_modules/@vitest/mocker/package.json', 'node_modules/@vitest/runner/package.json'];
    assert.deepEqual(run.toolchainInputs.map(f => f.name).sort(), [...runtime, ...tools].sort());
    for (const f of run.toolchainInputs) assert.equal(sha(fs.readFileSync(path.join(toolRoot, f.name))), f.sha256, 'Stale native/runner input ' + f.name);
    const projection = file => {
      const original = read(file).toString(), edits = spec.edits.filter(e => e.path === file);
      let candidate = original, last = original.length;
      for (const e of [...edits].sort((a, b) => b.start - a.start)) {
        assert.ok(e.end <= last); assert.equal(candidate.slice(e.start, e.end), e.before);
        candidate = candidate.slice(0, e.start) + e.after + candidate.slice(e.end); last = e.start;
      }
      const joint = combined.files.find(f => f.path === file);
      assert.equal(joint.sourceSha256, sha(original)); assert.equal(joint.plannedSha256, sha(candidate));
      parse(candidate, { sourceType: 'module' }); return { original, candidate, edits };
    };
    const graph = new Map(o.initialGraph.files.map(f => [f.path, f]));
    assert.equal(graph.size, 43); assert.equal(o.initialGraph.files.length, 43);
    assert.deepEqual(o.restoredGraph, o.initialGraph);
    const expectedPaths = [], expectBytes = (file, bytes) => {
      expectedPaths.push(file); assert.equal(graph.get(file)?.sha256, sha(bytes), 'Wrong written bytes ' + file); assert.equal(graph.get(file)?.mode, 0o644);
    };
    assert.equal(o.sourcePlan.length, 3); assert.equal(o.sourcePlan.reduce((n, f) => n + f.edits.length, 0), 6);
    for (const f of spec.files) {
      const p = projection(f.path), record = o.sourcePlan.find(s => s.path === f.path);
      assert.equal(record.destination, f.destination); assert.equal(record.originalSha256, sha(p.original)); assert.equal(record.proposedSha256, sha(p.candidate)); assert.deepEqual(record.edits, p.edits);
      expectBytes('baseline/' + f.path, p.original); expectBytes('candidate/' + f.destination, p.candidate);
    }
    assert.equal(o.originalTestPlan.length, 2);
    for (const f of selection.originals) {
      const p = projection(f.path), record = o.originalTestPlan.find(s => s.path === f.path);
      const nodes = parse(p.original, { sourceType: 'module' }).program.body;
      const imports = nodes.filter(n => n.type === 'ImportDeclaration'), after = parse(p.candidate, { sourceType: 'module' }).program.body.filter(n => n.type === 'ImportDeclaration');
      assert.equal(imports.length, 2); assert.equal(after.length, 2); assert.equal(p.edits.length, 1);
      assert.ok(p.edits[0].start >= imports[1].start && p.edits[0].end <= imports[1].end);
      const bindings = list => list.flatMap(n => n.specifiers.map(s => [s.local.name, s.imported?.name || s.type]));
      assert.deepEqual(bindings(imports), bindings(after));
      const body = p.original.slice(imports.at(-1).end); assert.equal(p.candidate.slice(after.at(-1).end), body);
      assert.equal(record.unchangedBodySha256, sha(body)); assert.equal(record.originalSha256, sha(p.original)); assert.equal(record.proposedSha256, sha(p.candidate)); assert.deepEqual(record.edits, p.edits);
      assert.equal(nodes[2].expression.callee.name, 'describe'); assert.equal(nodes[2].expression.arguments[0].value, f.suite);
      assert.deepEqual(nodes[2].expression.arguments[1].body.body.filter(n => n.expression?.callee?.name === 'it').map(n => n.expression.arguments[0].value), f.titles);
      expectBytes('baseline/' + f.path, p.original); expectBytes('candidate/' + f.path, p.candidate);
    }
    for (const f of spec.newFiles) expectBytes('candidate/' + f.path, f.sourceText);
    assert.deepEqual(o.assetMoves, spec.assetMoves);
    for (const f of spec.assetMoves) { const bytes = read(f.path); assert.equal(sha(bytes), f.sha256); expectBytes('baseline/' + f.path, bytes); expectBytes('candidate/' + f.destination, bytes); }
    const json = value => JSON.stringify(value, null, 2) + '\n';
    expectBytes('candidate/platform/public/package.json', json({ name: '@daylight/platform', private: true, version: '0.0.0', type: 'module', ...spec.packageFragments.public }));
    expectBytes('candidate/platform/server/package.json', json({ name: '@daylight-internal/platform--server', private: true, version: '0.0.0', type: 'module', ...spec.packageFragments.server }));
    for (const variant of ['baseline', 'candidate']) {
      expectBytes(variant + '/package.json', json({ name: 'daylight-rendering-' + variant, private: true, type: 'module', ...(variant === 'candidate' ? { workspaces: ['platform/public', 'platform/server'] } : { imports: { '#rendering/*': JSON.parse(read('package.json')).imports['#rendering/*'] } }) }));
      expectBytes(variant + '/explicit-fonts/roboto-condensed/RobotoCondensed-Regular.ttf', read('backend/assets/fonts/roboto-condensed/RobotoCondensed-Regular.ttf'));
      expectBytes(variant + '/probe.mjs', read(prefix + 'fixtures/rendering-identity.mjs'));
      // These hashes include the physical temp path, sanitized from published evidence.
      const name = variant + '/expectation.json'; expectedPaths.push(name); assert.match(graph.get(name)?.sha256, /^[a-f0-9]{64}$/); assert.equal(graph.get(name)?.mode, 0o644);
    }
    assert.deepEqual([...graph.keys()].sort(), expectedPaths.sort());
    const links = [
      ['baseline/backend/node_modules/canvas', '<installed-toolchain>/backend/node_modules/canvas'], ['baseline/node_modules/vitest', '<installed-toolchain>/node_modules/vitest'],
      ['candidate/platform/server/node_modules/canvas', '<installed-toolchain>/backend/node_modules/canvas'], ['candidate/node_modules/vitest', '<installed-toolchain>/node_modules/vitest'],
      ['candidate/node_modules/@daylight/platform', '<run-root>/candidate/platform/public'], ['candidate/node_modules/@daylight-internal/platform--server', '<run-root>/candidate/platform/server'],
    ].map(([file, target]) => ({ path: file, target })).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(o.initialGraph.links, links);
    assert.equal(o.installedCanvas, '3.1.0'); assert.equal(o.declaredCanvas, '^3.2.1'); assert.deepEqual(o.dependencyGate, spec.dependencyGate);
    assert.deepEqual(o.publicExports, spec.packageFragments.public.exports); assert.deepEqual(o.privateExports, spec.packageFragments.server.exports);
    const labels = ['baseline-native', 'baseline-originals', 'candidate-native', 'candidate-originals', 'duplicate-layout-red', 'layout-restored', 'wrong-font-root-red', 'font-root-restored', 'missing-font-red', 'font-restored', 'missing-notice-red', 'notice-restored', 'root-canvas-fallback-red', 'native-final-restored', 'originals-final-restored'];
    assert.deepEqual(o.records.map(r => r.label), labels);
    for (const r of o.records) {
      const mutation = r.label.endsWith('-red') ? r.label.slice(0, -4) : null;
      assert.equal(r.variant, r.label.startsWith('baseline-') ? 'baseline' : 'candidate');
      assert.equal(r.exitCode, mutation ? 1 : 0); assert.equal(r.stderr, ''); assert.equal(r.populationMatches, true);
      if (r.label.includes('originals')) {
        assert.equal(r.kind, 'originals'); assert.equal(r.result.success, true);
        assert.equal(r.result.numTotalTests, 10); assert.equal(r.result.numPassedTests, 10);
        for (const name of ['numFailedTests', 'numPendingTests', 'numTodoTests']) assert.equal(r.result[name], 0);
        assert.equal(r.result.testResults.length, 2); assert.equal(r.population.length, 2);
        for (const f of selection.originals) {
          const s = r.result.testResults.find(t => t.name === '<run-root>/' + r.variant + '/' + f.path);
          assert.equal(s.status, 'passed'); assert.equal(s.assertionResults.length, 5);
          const names = s.assertionResults.map(a => { assert.equal(a.status, 'passed'); assert.deepEqual(a.failureMessages, []); return { title: a.title, ancestorTitles: a.ancestorTitles, fullName: a.fullName }; });
          assert.deepEqual(names, f.titles.map(title => ({ title, ancestorTitles: [f.suite], fullName: f.suite + ' ' + title })));
          assert.deepEqual(r.population.find(p => p.path === f.path), { path: f.path, assertions: names, passed: true, namesMatch: true });
        }
      } else {
        assert.equal(r.kind, 'probe'); assert.equal(r.mutation, mutation); assert.deepEqual(JSON.parse(r.stdout), r.result);
        const failed = mutation ? selection.mutations[mutation] : []; assert.ok(failed);
        assert.equal(r.result.count, 10); assert.equal(r.result.passed, !mutation);
        assert.deepEqual(r.result.results.map(p => p.id), selection.probeIds); assert.deepEqual(r.result.failedIds, failed);
        for (const p of r.result.results) assert.equal(p.passed, !failed.includes(p.id));
        if (!mutation) {
          const draw = r.result.results.find(p => p.id === 'REND-DRAWING').observation; assert.deepEqual(draw, o.drawingParity);
          assert.equal(draw.metrics.length, 7); assert.equal(draw.width, 240); assert.equal(draw.height, 150);
          for (const f of draw.metrics) { assert.ok(Number.isFinite(f.width) && f.width > 0); assert.ok(f.lines.length > 0); }
          for (const key of ['pngSha256', 'pixelSha256', 'rotatedSha256']) assert.match(draw[key], /^[a-f0-9]{64}$/);
          assert.equal(r.result.results.find(p => p.id === 'REND-NATIVE').observation.version, '3.1.0');
        }
      }
    }
    return { passed: true, error: null };
  } catch (error) { return { passed: false, error: error.message }; }
}
