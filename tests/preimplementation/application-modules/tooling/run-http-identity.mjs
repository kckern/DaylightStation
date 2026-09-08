/** Exact selected HTTP/utility/logging fragments in a disposable native graph. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { builtinModules, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const self = fileURLToPath(import.meta.url), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const testRoot = path.join(root, 'tests/preimplementation/application-modules');
const profile = path.join(testRoot, 'configs/package-install.sbp');
const template = path.join(testRoot, 'fixtures/http-identity.mjs'), selectionPath = path.join(testRoot, 'fixtures/http-identity.json');
const casesPath = path.join(testRoot, 'cases/http-middleware.case.mjs'), caseSelectionPath = path.join(testRoot, 'fixtures/http-middleware.json');
const selection = JSON.parse(fs.readFileSync(selectionPath)), caseSelection = JSON.parse(fs.readFileSync(caseSelectionPath));
const originalsSelectionPath = path.join(testRoot, 'fixtures/server-foundation.json'), originalsConfig = path.join(testRoot, 'configs/http-originals.mjs');
const originalsSelection = JSON.parse(fs.readFileSync(originalsSelectionPath));
assert.equal(originalsSelection.files.length, 4);
assert.equal(originalsSelection.files.reduce((sum, f) => sum + f.expectedCases, 0), 64);
const specNames = ['http-boundary.json', 'utility-boundary.json', 'utility-reference-review.json', 'logging-boundary.json', 'combined-boundary-review.json'];
const [http, utility, references, logging, combined] = specNames.map(n => JSON.parse(fs.readFileSync(path.join(packet, n))));
const utilityPaths = ['backend/src/0_system/utils/errors/InfrastructureError.mjs', 'backend/src/0_system/utils/time.mjs', 'backend/src/2_domains/core/utils/time.mjs', 'backend/src/2_domains/core/utils/timezone.mjs'];
const files = [...http.files, ...logging.files, ...utility.files.filter(f => utilityPaths.includes(f.path))];
assert.equal(files.length, 11); assert.equal(new Set(files.map(f => f.destination)).size, 11);
const facades = [http.facade, ...logging.facades, ...utility.facades.filter(f => files.some(file => file.destination === f.target))];
assert.equal(facades.length, 9);
const edits = [...utility.edits, ...references.edits, ...http.edits, ...logging.edits].filter(e => files.some(f => f.path === e.path));
assert.equal(edits.length, 7);
const toolRoot = fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const require = createRequire(path.join(toolRoot, 'package.json'));
const parserPath = require.resolve('@babel/parser'), parserManifest = require.resolve('@babel/parser/package.json');
const { parse } = require('@babel/parser');
const uuidRoot = fs.realpathSync(path.join(toolRoot, 'backend/node_modules/uuid'));
assert.ok(uuidRoot.startsWith(path.join(toolRoot, 'backend/node_modules') + path.sep), 'Unexpected UUID installation authority');
const uuidManifest = JSON.parse(fs.readFileSync(path.join(uuidRoot, 'package.json')));
assert.equal(uuidManifest.version, '11.1.0'); assert.equal(Object.keys(uuidManifest.dependencies || {}).length, 0);
assert.equal(uuidManifest.exports['.'].node.import, './dist/esm/index.js');
assert.equal(uuidManifest.exports['.'].node.require, './dist/cjs/index.js');
function vendorFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'Unreviewed vendor symlink');
    const file = path.join(directory, e.name), name = prefix + e.name;
    if (e.isDirectory()) return vendorFiles(file, name + '/');
    assert.ok(e.isFile(), 'Unreviewed vendor special file');
    return [{ name, sha256: sha(fs.readFileSync(file)) }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
const vendorInputs = vendorFiles(uuidRoot);
const vitestInputs = ['node_modules/vitest/package.json', 'node_modules/vitest/vitest.mjs', 'node_modules/vite/package.json', 'node_modules/@vitest/mocker/package.json', 'node_modules/@vitest/runner/package.json'];
const toolchainInputs = [...vendorInputs.map(f => ({ name: 'backend/node_modules/uuid/' + f.name, sha256: f.sha256 })), ...[parserPath, parserManifest, ...vitestInputs.map(f => path.join(toolRoot, f))].map(f => ({ name: path.relative(toolRoot, f), sha256: sha(fs.readFileSync(f)) }))];
const baselineCandidates = fs.readdirSync(path.join(packet, 'evidence')).filter(f => /^server-foundation-.*\.json$/.test(f)).map(file => ({ file: 'evidence/' + file, report: JSON.parse(fs.readFileSync(path.join(packet, 'evidence', file))) }));
const baselineRun = baselineCandidates.filter(({ report: r }) => r.pack === 'server-foundation' && r.exitCode === 0 && r.populationMatches && r.node === process.version && r.baseline === http.baseline
  && r.inputBase === 'repository root' && r.inputs.length >= 11 && r.inputs.every(i => sha(fs.readFileSync(path.join(root, i.name))) === i.sha256))
  .sort((a, b) => b.report.capturedAt.localeCompare(a.report.capturedAt))[0];
assert.ok(baselineRun, 'Fresh passing original server-foundation receipt required');
const originalPopulation = originalsSelection.files.map(f => {
  const suite = baselineRun.report.outcome.testResults.find(s => s.name === '<worktree>/' + f.path);
  assert.equal(suite?.status, 'passed'); assert.equal(suite.assertionResults.length, f.expectedCases);
  assert.ok(suite.assertionResults.every(a => a.status === 'passed' && a.failureMessages.length === 0));
  const assertions = suite.assertionResults.map(({ fullName, title, ancestorTitles }) => ({ fullName, title, ancestorTitles }));
  assert.equal(new Set(assertions.map(a => a.fullName)).size, f.expectedCases);
  return { path: f.path, assertions };
});
assert.equal(baselineRun.report.outcome.testResults.length, 4);
assert.equal(baselineRun.report.outcome.numTotalTests, 64); assert.equal(baselineRun.report.outcome.numPassedTests, 64);
assert.equal(baselineRun.report.outcome.numFailedTests, 0);
const originalTestTexts = new Map();
const originalTestPlan = originalsSelection.files.map(f => {
  const original = fs.readFileSync(path.join(root, f.path), 'utf8');
  const joint = combined.files.find(j => j.path === f.path); assert.equal(sha(original), joint?.sourceSha256);
  const imports = text => parse(text, { sourceType: 'module' }).program.body.filter(n => n.type === 'ImportDeclaration');
  const beforeImports = imports(original);
  const changes = [...http.edits, ...logging.edits].filter(e => e.path === f.path);
  assert.ok(changes.length > 0);
  let text = original, last = original.length;
  for (const e of [...changes].sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= last && beforeImports.some(n => e.start >= n.start && e.end <= n.end), 'Non-import original-suite edit');
    assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); last = e.start;
  }
  assert.equal(sha(text), joint.plannedSha256);
  const afterImports = imports(text);
  const bindings = nodes => nodes.flatMap(n => n.specifiers.map(s => [s.local.name, s.imported?.name || s.type])).sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(bindings(afterImports), bindings(beforeImports));
  assert.ok(afterImports.every(n => n.source.value === 'vitest' || facades.some(f => f.entry === n.source.value)));
  const prelude = s => s.slice(0, imports(s)[0].start), body = s => s.slice(imports(s).at(-1).end);
  assert.equal(prelude(text), prelude(original)); assert.equal(body(text), body(original));
  for (const s of [original, text]) assert.ok(parse(s, { sourceType: 'module' }).program.body.every(n => n.type === 'ImportDeclaration' || n.start >= imports(s).at(-1).end));
  originalTestTexts.set(f.path, text);
  return { path: f.path, destination: f.path, originalSha256: sha(original), proposedSha256: sha(text), unchangedPreludeSha256: sha(prelude(original)), unchangedBodySha256: sha(body(original)), edits: changes.map(({ id, start, end, before, after }) => ({ id, start, end, before, after })) };
});
assert.equal(originalTestPlan.reduce((sum, f) => sum + f.edits.length, 0), 5);
const originalReference = { file: baselineRun.file, sha256: sha(fs.readFileSync(path.join(packet, baselineRun.file))), id: baselineRun.report.id, node: baselineRun.report.node };
const proposed = new Map(), sourcePlan = [];
for (const file of files) {
  let text = fs.readFileSync(path.join(root, file.path), 'utf8'); assert.equal(sha(text), file.sha256);
  let last = text.length;
  for (const edit of edits.filter(e => e.path === file.path).sort((a, b) => b.start - a.start)) {
    assert.ok(edit.end <= last); assert.equal(text.slice(edit.start, edit.end), edit.before);
    text = text.slice(0, edit.start) + edit.after + text.slice(edit.end); last = edit.start;
  }
  const joint = combined.files.find(f => f.path === file.path);
  assert.equal(sha(text), joint?.plannedSha256 || file.sha256, 'Selected bytes differ from combined specification: ' + file.path);
  proposed.set(file.destination, text);
  sourcePlan.push({ path: file.path, destination: file.destination, originalSha256: file.sha256, proposedSha256: sha(text), edits: edits.filter(e => e.path === file.path).map(e => ({ start: e.start, end: e.end, before: e.before, after: e.after })) });
}
const sourceEdges = [];
for (const [file, text] of proposed) for (const node of parse(text, { sourceType: 'module' }).program.body) {
  if (!node.source || !['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) continue;
  const specifier = node.source.value;
  if (specifier.startsWith('.')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    assert.ok(proposed.has(target), 'Missing native source target ' + target);
    sourceEdges.push({ from: file, specifier, target });
  } else {
    assert.ok(specifier === 'uuid' || builtinModules.includes(specifier) || specifier.startsWith('node:'), 'Unreviewed runtime dependency ' + specifier);
    sourceEdges.push({ from: file, specifier, target: specifier });
  }
}
const closure = new Set([http.facade.target]), pending = [...closure];
for (let i = 0; i < pending.length; i++) for (const e of sourceEdges.filter(e => e.from === pending[i])) if (proposed.has(e.target) && !closure.has(e.target)) { closure.add(e.target); pending.push(e.target); }
assert.equal(closure.size, 11);
const publicExports = {}, privateExports = {};
for (const facade of facades) {
  assert.equal(sha(facade.sourceText), facade.sha256);
  const publicKey = facade.entry.replace('@daylight/platform', '.'), privateKey = facade.privateEntry.replace('@daylight-internal/platform--server', '.');
  const expectedPublic = './' + facade.path.replace('platform/public/', ''), expectedPrivate = './' + facade.target.replace('platform/server/', '');
  assert.equal(({ ...http.packageFragments.public.exports, ...logging.packageFragments.public.exports, ...utility.packageFragments.publicPackage.exports })[publicKey], expectedPublic);
  assert.equal(({ ...http.packageFragments.server.exports, ...logging.packageFragments.server.exports, ...utility.packageFragments.serverPackage.exports })[privateKey], expectedPrivate);
  publicExports[publicKey] = expectedPublic; privateExports[privateKey] = expectedPrivate;
}
assert.equal(Object.keys(privateExports).length, 8);
const caseImportEdits = [
  ["'../../../../backend/src/0_system/http/middleware/index.mjs'", "'@daylight/platform/server/system/http/middleware'"],
  ["import { initializeLogging, resetLogging } from '../../../../backend/src/0_system/logging/dispatcher.mjs';", "import { initializeLogging } from '@daylight/platform/server/system/logging/dispatcher';\nimport { resetLogging } from '@daylight/platform/server/system/logging/testing';"],
  ["'../../../../backend/src/0_system/utils/errors/InfrastructureError.mjs'", "'@daylight/platform/server/system/utils/errors/infrastructure-error'"],
];
const originalCases = fs.readFileSync(casesPath, 'utf8'); let nativeCases = originalCases;
for (const [before, after] of caseImportEdits) { assert.equal(nativeCases.split(before).length, 2); nativeCases = nativeCases.replace(before, after); }
const body = text => text.slice(text.indexOf('\nlet events;'));
assert.ok(originalCases.includes('\nlet events;')); assert.equal(body(nativeCases), body(originalCases));
parse(nativeCases, { sourceType: 'module' });
if (process.argv[2] === '--worker') {
  assert.equal(process.argv.length, 3);
  const runRoot = fs.realpathSync(process.env.PRE_RUN_ROOT); assert.ok(path.basename(runRoot).startsWith('daylight-http-identity-'));
  const fixture = path.join(runRoot, 'fixture'); fs.mkdirSync(fixture);
  const write = (name, value) => {
    const target = path.resolve(fixture, name); assert.ok(target.startsWith(fixture + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  };
  for (const [name, text] of proposed) write(name, text);
  for (const facade of facades) write(facade.path, facade.sourceText);
  write('package.json', { name: 'daylight-http-native-probe', private: true, type: 'module', workspaces: ['platform/public', 'platform/server'] });
  write('platform/public/package.json', { name: '@daylight/platform', version: '0.0.0', private: true, type: 'module', exports: publicExports, dependencies: { '@daylight-internal/platform--server': '0.0.0' } });
  write('platform/server/package.json', { name: '@daylight-internal/platform--server', version: '0.0.0', private: true, type: 'module', exports: privateExports, dependencies: { uuid: http.packageFragments.server.dependencies.uuid } });
  for (const [name, destination] of [['@daylight/platform', 'platform/public'], ['@daylight-internal/platform--server', 'platform/server']]) {
    const link = path.join(fixture, 'node_modules', name); fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(path.join(fixture, destination), link, 'dir');
  }
  fs.symlinkSync(path.join(toolRoot, 'node_modules/vitest'), path.join(fixture, 'node_modules/vitest'), 'dir');
  for (const [name, text] of originalTestTexts) write(name, text);
  const vendorDestination = path.join(fixture, 'platform/server/node_modules/uuid');
  fs.cpSync(uuidRoot, vendorDestination, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(vendorFiles(vendorDestination), vendorInputs);
  write('platform/server/probe-resolution.mjs', "import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nimport { createRequire } from 'node:module';\nimport { v4 } from 'uuid';\nimport metadata from 'uuid/package.json' with { type: 'json' };\nconst here=path.dirname(fileURLToPath(import.meta.url));\nexport { v4 };\nexport const version=metadata.version;\nexport const esmUrl=import.meta.resolve('uuid');\nexport const esmRelative=path.relative(here,fileURLToPath(esmUrl));\nexport const cjsRelative=path.relative(here,createRequire(import.meta.url).resolve('uuid'));\n");
  write('expectation.json', { probeIds: selection.probeIds, facades: facades.map(f => ({ entry: f.entry, names: f.names })) });
  write('probe.mjs', fs.readFileSync(template, 'utf8')); write('contracts.case.mjs', nativeCases);
  const verifyWrittenGraph = () => {
    const sourceHashes = sourcePlan.map(f => ({ path: f.destination, sha256: sha(fs.readFileSync(path.join(fixture, f.destination))) }));
    assert.deepEqual(sourceHashes, sourcePlan.map(f => ({ path: f.destination, sha256: f.proposedSha256 })));
    const facadeHashes = facades.map(f => ({ path: f.path, sha256: sha(fs.readFileSync(path.join(fixture, f.path))) }));
    assert.deepEqual(facadeHashes, facades.map(f => ({ path: f.path, sha256: f.sha256 })));
    const publicManifest = JSON.parse(fs.readFileSync(path.join(fixture, 'platform/public/package.json')));
    const serverManifest = JSON.parse(fs.readFileSync(path.join(fixture, 'platform/server/package.json')));
    assert.deepEqual(publicManifest.exports, publicExports); assert.deepEqual(serverManifest.exports, privateExports);
    assert.deepEqual(serverManifest.dependencies, { uuid: http.packageFragments.server.dependencies.uuid });
    assert.deepEqual(vendorFiles(vendorDestination), vendorInputs);
    const enumerate = directory => fs.readdirSync(path.join(fixture, directory), { withFileTypes: true }).flatMap(e => {
      if (e.name === 'node_modules') return [];
      assert.ok(!e.isSymbolicLink());
      const file = directory + '/' + e.name;
      return e.isDirectory() ? enumerate(file) : file.endsWith('.mjs') && file !== 'platform/server/probe-resolution.mjs' ? [file] : [];
    });
    assert.deepEqual(enumerate('platform/server').sort(), sourcePlan.map(f => f.destination).sort(), 'Unexpected duplicate private implementation remains');
    assert.equal(fs.realpathSync(path.join(fixture, 'node_modules/@daylight/platform')), path.join(fixture, 'platform/public'));
    assert.equal(fs.realpathSync(path.join(fixture, 'node_modules/@daylight-internal/platform--server')), path.join(fixture, 'platform/server'));
    assert.equal(fs.realpathSync(path.join(fixture, 'node_modules/vitest')), fs.realpathSync(path.join(toolRoot, 'node_modules/vitest')));
    const originalTestHashes = originalTestPlan.map(f => ({ path: f.destination, sha256: sha(fs.readFileSync(path.join(fixture, f.destination))) }));
    assert.deepEqual(originalTestHashes, originalTestPlan.map(f => ({ path: f.destination, sha256: f.proposedSha256 })));
    return { sourceHashes, facadeHashes, originalTestHashes, publicManifestSha256: sha(fs.readFileSync(path.join(fixture, 'platform/public/package.json'))), serverManifestSha256: sha(fs.readFileSync(path.join(fixture, 'platform/server/package.json'))), uuidTreeSha256: sha(JSON.stringify(vendorInputs)), privatePopulation: 11, manualLinksCanonical: true, vitestLinkCanonical: true };
  };
  const records = [];
  const probe = (label, mutation = null) => {
    const r = spawnSync(process.execPath, ['probe.mjs'], { cwd: fixture, env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    let result = null; try { result = JSON.parse(r.stdout); } catch { /* retained as a failed setup, never a passing negative */ }
    const failedIds = mutation ? selection.mutations[mutation] : [];
    const populationMatches = result?.count === 12 && JSON.stringify(result.results?.map(r => r.id)) === JSON.stringify(selection.probeIds);
    records.push({ label, kind: 'probe', mutation, exitCode: r.status, expectedExit: mutation ? 1 : 0, populationMatches, result, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, mutation ? 1 : 0, label + ': ' + r.stderr); assert.equal(populationMatches, true, label + ': missing probe population');
    assert.deepEqual(result.failedIds, failedIds, label + ': wrong failed probes');
    assert.equal(result.passed, !mutation); assert.equal(r.stderr, '', label + ': unexpected native diagnostic');
  };
  const contracts = label => {
    const r = spawnSync(process.execPath, ['contracts.case.mjs'], { cwd: fixture, env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    const ids = [...r.stdout.matchAll(/^ok \d+ - (CASE-\S+)/gm)].map(m => m[1]);
    const populationMatches = /^# tests 37$/m.test(r.stdout) && /^# fail 0$/m.test(r.stdout) && ['skipped', 'todo', 'cancelled'].every(k => new RegExp('^# ' + k + ' 0$', 'm').test(r.stdout)) && JSON.stringify(ids.sort()) === JSON.stringify([...caseSelection.caseIds].sort());
    records.push({ label, kind: 'contracts', exitCode: r.status, expectedExit: 0, populationMatches, caseIds: ids, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, 0, label + ': ' + r.stderr); assert.equal(populationMatches, true, label + ': case population mismatch'); assert.equal(r.stderr, '');
  };
  const originals = label => {
    const output = path.join(runRoot, label + '.json');
    const r = spawnSync(process.execPath, [path.join(toolRoot, 'node_modules/vitest/vitest.mjs'), 'run', '--config', originalsConfig, '--configLoader', 'native', '--reporter=json', '--outputFile=' + output], { cwd: fixture, env: process.env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const result = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : null;
    const population = originalsSelection.files.map(f => {
      const suite = result?.testResults?.find(s => s.name === path.join(fixture, f.path));
      const assertions = suite?.assertionResults || [];
      return { path: f.path, expectedCases: f.expectedCases, actualCases: assertions.length, passed: assertions.filter(a => a.status === 'passed').length,
        namesMatch: JSON.stringify(assertions.map(({ fullName, title, ancestorTitles }) => ({ fullName, title, ancestorTitles }))) === JSON.stringify(originalPopulation.find(p => p.path === f.path).assertions),
        allPassed: suite?.status === 'passed' && assertions.length === f.expectedCases && assertions.every(a => a.status === 'passed' && a.failureMessages.length === 0) };
    });
    const populationMatches = result?.success === true && result.numTotalTests === 64 && result.numPassedTests === 64 && result.numFailedTests === 0
      && result.numPendingTests === 0 && result.numTodoTests === 0 && result.testResults.length === 4 && population.every(p => p.namesMatch && p.allPassed);
    records.push({ label, kind: 'originals', exitCode: r.status, expectedExit: 0, populationMatches, population, result, stdout: r.stdout, stderr: r.stderr });
    assert.equal(r.status, 0, label + ': ' + r.stderr); assert.equal(populationMatches, true, label + ': original assertion population mismatch');
  };
  const relativeForward = (facade, target, names = facade.names) => {
    const relative = path.posix.relative(path.posix.dirname(facade.path), target);
    return `export { ${names.join(', ')} } from '${relative.startsWith('.') ? relative : './' + relative}';\n`;
  };
  let outcome;
  try {
    const initialWrittenGraph = verifyWrittenGraph();
    probe('native-initial'); contracts('contracts-initial'); originals('originals-initial');
    const errorLeaf = 'platform/server/system/http/middleware/errorHandler.mjs';
    const errorCopy = errorLeaf.replace('.mjs', '-copy.mjs'); write(errorCopy, proposed.get(errorLeaf));
    write(http.facade.path, `export { requestLoggerMiddleware, tracingMiddleware } from '${http.facade.privateEntry}';\n` + relativeForward(http.facade, errorCopy, ['asyncHandler', 'errorHandlerMiddleware']));
    probe('duplicate-middleware-red', 'duplicate-middleware'); write(http.facade.path, http.facade.sourceText); fs.unlinkSync(path.join(fixture, errorCopy)); probe('middleware-restored');
    const errorFacade = facades.find(f => f.entry.endsWith('/infrastructure-error'));
    const classCopy = errorFacade.target.replace('.mjs', '-copy.mjs'); write(classCopy, proposed.get(errorFacade.target));
    write(errorFacade.path, relativeForward(errorFacade, classCopy));
    probe('duplicate-error-red', 'duplicate-error'); write(errorFacade.path, errorFacade.sourceText); fs.unlinkSync(path.join(fixture, classCopy)); probe('error-restored');
    const dispatcherFacade = logging.facades.find(f => f.entry.endsWith('/dispatcher'));
    const dispatcherCopy = dispatcherFacade.target.replace('.mjs', '-copy.mjs'); write(dispatcherCopy, proposed.get(dispatcherFacade.target));
    write(dispatcherFacade.path, relativeForward(dispatcherFacade, dispatcherCopy));
    probe('duplicate-dispatcher-red', 'duplicate-dispatcher'); write(dispatcherFacade.path, dispatcherFacade.sourceText); fs.unlinkSync(path.join(fixture, dispatcherCopy)); probe('dispatcher-restored');
    write(http.facade.path, http.facade.sourceText + relativeForward(http.facade, errorLeaf, ['default']));
    probe('leaked-default-red', 'leaked-default'); write(http.facade.path, http.facade.sourceText); probe('native-final-restored');
    contracts('contracts-final-restored'); originals('originals-final-restored');
    const restoredWrittenGraph = verifyWrittenGraph(); assert.deepEqual(restoredWrittenGraph, initialWrittenGraph);
    outcome = { passed: true, records, sourcePlan, sourceEdges, originalTestPlan, originalReference, originalPopulation, initialWrittenGraph, restoredWrittenGraph, facadeHashes: facades.map(f => ({ path: f.path, sha256: f.sha256 })), publicExports, privateExports, declaredUuidRange: http.packageFragments.server.dependencies.uuid, vendorFiles: vendorInputs.length, vendorTreeSha256: sha(JSON.stringify(vendorInputs)), originalClosure: http.originalLoadingClosure.files.length, nativeClosure: closure.size, caseImports: caseImportEdits.map(([before, after]) => ({ before, after })), originalCaseSha256: sha(originalCases), nativeCaseSha256: sha(nativeCases), unchangedCaseBodySha256: sha(body(originalCases)), node: process.version };
  } catch (error) { outcome = { passed: false, error: error.message, records }; }
  fs.writeFileSync(path.join(runRoot, 'outcome.json'), JSON.stringify(outcome, null, 2));
  if (!outcome.passed) process.exitCode = 1;
} else {
  assert.equal(process.argv.length, 2);
  const runRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-http-identity-')));
  const params = { WORKTREE: root, RUN_ROOT: runRoot, ROOT_DEPS: path.join(toolRoot, 'node_modules'), BACKEND_DEPS: path.join(toolRoot, 'backend/node_modules'), FRONTEND_DEPS: path.join(toolRoot, 'frontend/node_modules'), NODE_BINARY: fs.realpathSync(process.execPath) };
  const args = [...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]), '-f', profile, process.execPath, self, '--worker'];
  const r = spawnSync('/usr/bin/sandbox-exec', args, { cwd: root, encoding: 'utf8', timeout: 240000, maxBuffer: 6 * 1024 * 1024, env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', NODE_ENV: 'test', TZ: 'UTC', PRE_TOOLCHAIN_ROOT: toolRoot, PRE_RUN_ROOT: runRoot, TMPDIR: runRoot, XDG_CACHE_HOME: path.join(runRoot, 'cache') } });
  const clean = value => String(value || '').replaceAll(root, '<worktree>').replaceAll(toolRoot, '<installed-toolchain>').replaceAll(runRoot, '<run-root>').replaceAll('/opt/homebrew', '<system-toolchain>');
  const outcomePath = path.join(runRoot, 'outcome.json'), outcome = fs.existsSync(outcomePath) ? JSON.parse(clean(fs.readFileSync(outcomePath, 'utf8'))) : null;
  const inputs = [...new Set([self, profile, template, selectionPath, casesPath, caseSelectionPath, originalsSelectionPath, originalsConfig, path.join(packet, baselineRun.file), ...baselineRun.report.inputs.map(i => path.join(root, i.name)), path.join(testRoot, 'tooling/census.mjs'), ...specNames.map(n => path.join(packet, n)), ...files.map(f => path.join(root, f.path))])].map(f => ({ name: path.relative(root, f), sha256: sha(fs.readFileSync(f)) }));
  const report = { schema: 'daylight.preimplementation.http-identity/v1', id: 'RUN-HTTP-IDENTITY-' + Date.now(), pack: 'http-identity', capturedAt: new Date().toISOString(), baseline: http.baseline, inputBase: 'repository root', inputs, toolchainInputs, command: 'PRE_TOOLCHAIN_ROOT=<installed-toolchain> node tests/preimplementation/application-modules/tooling/run-http-identity.mjs', exitCode: r.status, signal: r.signal, outcome, stdout: clean(r.stdout), stderr: clean(r.stderr), limits: ['Eleven source files at exact proposed destinations, seven pre-specified import/comment edits, nine exact facade paths/bytes and selected manifest fragments; not the full workspace candidate, install/lock/build or controller', 'Original installed backend UUID 11.1.0 package copied byte-for-byte under the private server facet; native Node import/require conditions checked, not full original peer/range/lock adoption', 'Twelve native probes over nine probe runs with four exact counterexamples; the same 37 dedicated assertions and 64 original assertions each run twice. Five exact proposed original-suite import edits preserve prelude/helper/assertion body hashes and original local bindings; named populations match a fresh baseline receipt. Repeated execution and mechanism observations do not increase baseline assertion/product-mutation counts', 'No preparation loader, source aliases, root setup, live server, network, real transport/provider/device or private records. Vitest is linked only within the disposable fixture. Response doubles remain distinct from real Express socket/status/header behavior', 'The test-only logging entry is intentionally native-importable; actual caller/layer enforcement and remaining affected protected suites remain separate gates'] };
  const name = 'http-identity-' + new Date().toISOString().replaceAll(':', '-') + '.json';
  fs.writeFileSync(path.join(packet, 'evidence', name), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ evidence: 'evidence/' + name, exitCode: r.status, passed: outcome?.passed, error: outcome?.error, records: outcome?.records.map(r => ({ label: r.label, exitCode: r.exitCode, populationMatches: r.populationMatches, failedIds: r.result?.failedIds, cases: r.caseIds?.length })), stderr: clean(r.stderr) }) + '\n');
  if (r.status !== 0 || !outcome?.passed) process.exitCode = 1;
}
