/** Selected HTTP middleware ownership/public-entry/source proposal; no runtime evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { parse } = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const inventoryNames = ['source-ledger.json', 'dependency-ledger.json', 'boundary-review.json', 'owner-boundaries.json', 'utility-boundary.json', 'utility-reference-review.json'];
const [ledger, graph, foundation, owners, utility, utilityReferences] = inventoryNames.map(name => JSON.parse(fs.readFileSync(path.join(packet, name))));
const prefix = 'backend/src/0_system/http/middleware/';
const paths = ['index.mjs', 'errorHandler.mjs', 'requestLogger.mjs', 'tracing.mjs'].map(n => prefix + n);
const selected = new Set(paths), inputs = new Map(), sources = new Map(), asts = new Map();
const entry = '@daylight/platform/server/system/http/middleware';
const privateEntry = '@daylight-internal/platform--server/system/http/middleware';
const names = ['asyncHandler', 'errorHandlerMiddleware', 'requestLoggerMiddleware', 'tracingMiddleware'];
function source(file) {
  if (!sources.has(file)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8'), digest = sha(text);
    assert.equal(digest, ledger.files.find(f => f.path === file)?.sha256, 'Changed protected source: ' + file);
    inputs.set(file, { path: file, sha256: digest }); sources.set(file, text);
  }
  return sources.get(file);
}
function ast(file) {
  if (!asts.has(file)) asts.set(file, parse(source(file), { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true }));
  return asts.get(file);
}
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'comments', 'tokens', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(n => walk(n, fn));
    else if (value && typeof value === 'object') walk(value, fn);
  }
}
const destination = file => owners.moves.find(m => m.old === file)?.new || foundation.files.find(f => f.path === file)?.proposedPath || file;
const files = paths.map(file => {
  const candidate = foundation.files.find(f => f.path === file);
  assert.equal(candidate.owner, 'platform'); assert.equal(candidate.layer, 'system');
  return { path: file, destination: candidate.proposedPath, sha256: sha(source(file)), owner: 'platform', category: 'platform', runtime: 'server', layer: 'system', context: null, rank: null, action: 'Move once; keep cohesive private middleware barrel and original bodies/default leaf exports' };
});
const allEdges = graph.edges.filter(e => selected.has(e.target)), edits = [], edgeDispositions = [];
assert.equal(allEdges.length, 85);
for (const edge of allEdges) {
  if (selected.has(edge.from)) {
    assert.equal(edge.from, prefix + 'index.mjs'); assert.equal(edge.syntax, 'ExportNamedDeclaration');
    edgeDispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'Private cohesive barrel re-export unchanged; preserves original eager loading of all three leaves' });
    continue;
  }
  let literal;
  walk(ast(edge.from), node => {
    const candidate = node.type === 'ImportDeclaration' ? node.source : node.type === 'CallExpression' && node.callee.type === 'Import' ? node.arguments[0] : null;
    if (!candidate || candidate.value !== edge.specifier) return;
    if ('EDGE-' + sha(edge.from + ':' + node.start + ':' + candidate.value).slice(0, 16) === edge.id) { assert.ok(!literal); literal = candidate; }
  });
  assert.ok(literal, 'Missing exact import literal: ' + edge.id);
  assert.ok(edge.symbols.every(s => names.includes(s.imported)), 'Unexpected namespace/default import: ' + edge.id);
  const start = literal.start + 1, end = literal.end - 1;
  assert.equal(source(edge.from).slice(start, end), edge.specifier, 'Escaped literal needs separate proposal');
  const id = 'HTTP-IMPORT-' + edge.id.slice(5);
  edits.push({ id, edgeId: edge.id, path: edge.from, destination: destination(edge.from), line: literal.loc.start.line, start, end, before: edge.specifier, after: entry, kind: edge.syntax === 'dynamic-literal' ? 'lazy import literal only' : 'static import literal only' });
  edgeDispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, editId: id, action: 'Selected public four-name middleware entry; body, callback order and imported/local names unchanged' });
}
assert.equal(edits.length, 82);
const dynamic = allEdges.filter(e => e.syntax === 'dynamic-literal');
assert.equal(dynamic.length, 1);
assert.equal(dynamic[0].from, 'tests/isolated/api/school/schoolLifecycleRouter.test.mjs');
assert.ok(source(dynamic[0].from).includes("const { errorHandlerMiddleware } = await import('#system/http/middleware/index.mjs');"));
const guide = 'docs/reference/core/layers-of-abstraction/api-layer-guidelines.md';
for (const [line, before] of [[42, '0_system/http/middleware/'], [329, '0_system/http/middleware/'], [421, '#system/http/middleware/index.mjs']]) {
  const text = source(guide), startOfLine = text.split('\n').slice(0, line - 1).join('\n').length + (line === 1 ? 0 : 1);
  const at = text.indexOf(before, startOfLine);
  assert.ok(at >= startOfLine && at < startOfLine + text.split('\n')[line - 1].length);
  edits.push({ id: 'HTTP-REFERENCE-' + line, path: guide, line, start: at, end: at + before.length, before, after: entry, kind: 'Future spelling-only guide update; preserve all API layer prohibitions' });
}
const sourceText = `export { ${names.join(', ')} } from '${privateEntry}';\n`;
parse(sourceText, { sourceType: 'module' });
const facade = { entry, path: 'platform/public/server/system/http/middleware.mjs', target: 'platform/server/system/http/middleware/index.mjs', privateEntry, names, sourceText, sha256: sha(sourceText), owner: 'platform', category: 'platform', runtime: 'server', layer: 'system', context: null, rank: null };
const schoolGuardFile = 'tests/isolated/application/school/schoolcalcArchitecture.test.mjs';
const originalPermission = "specifier === '#system/http/middleware/index.mjs'";
const referenceChanges = [
  { id: 'HTTP-REFERENCE-SCHOOL-GUARD', path: schoolGuardFile, line: 123, before: originalPermission, after: `(${originalPermission} || specifier === '${entry}')`, kind: 'Exact baseline-or-selected-public-entry permission; no wildcard, private entry or broader layer permission' },
  { id: 'HTTP-REFERENCE-NETWORK-GUIDE', path: 'docs/reference/core/network-exposure.md', line: 5, before: 'backend/src/0_system/http/middleware/', after: 'platform/server/system/http/middleware/', kind: 'Spelling-only related-code directory; do not invent a target for the separately stale devProxy.mjs link' },
];
for (const change of referenceChanges) {
  const text = source(change.path), lineStart = text.split('\n').slice(0, change.line - 1).join('\n').length + 1;
  const start = text.indexOf(change.before, lineStart);
  assert.ok(start >= lineStart && start < lineStart + text.split('\n')[change.line - 1].length);
  edits.push({ ...change, destination: destination(change.path), start, end: start + change.before.length });
}
const editedFiles = [...new Set(edits.map(e => e.path))].sort().map(file => {
  let text = source(file), previous = text.length;
  for (const e of edits.filter(e => e.path === file).sort((a, b) => b.start - a.start)) {
    assert.ok(e.end <= previous); assert.equal(text.slice(e.start, e.end), e.before);
    text = text.slice(0, e.start) + e.after + text.slice(e.end); previous = e.start;
  }
  if (file.endsWith('.mjs')) parse(text, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
  return { path: file, destination: destination(file), sourceSha256: sha(source(file)), proposedSha256: sha(text) };
});
const closure = new Set(paths), queue = [...closure], packageEdges = [], unresolved = [];
for (let i = 0; i < queue.length; i++) for (const edge of graph.edges.filter(e => e.from === queue[i])) {
  if (edge.kind.startsWith('unresolved')) unresolved.push(edge);
  if (edge.kind === 'package') packageEdges.push(edge);
  if (edge.kind !== 'source' || closure.has(edge.target)) continue;
  closure.add(edge.target); queue.push(edge.target);
}
assert.equal(unresolved.length, 0);
for (const file of closure) source(file);
const backendManifest = JSON.parse(source('backend/package.json'));
const integrationEdits = [...utility.edits, ...utilityReferences.edits].filter(e => selected.has(e.path)).map(e => ({ path: e.path, start: e.start, end: e.end, before: e.before, after: e.after }));
const defaultExports = paths.filter(p => p !== prefix + 'index.mjs').map(p => ({ path: p, export: 'default', action: 'Retain privately, do not publish three unused default aliases' }));
// Inspect the existing global/double-mount source predicates as data. Never run
// this listener-opening suite or evaluate any router/controller source.
const mountTest = 'tests/isolated/assembly/infrastructure/http/requestLogger.test.mjs';
const appPath = 'backend/src/app.mjs', routerRoot = 'backend/src/4_api/v1/routers/';
const patterns = [], pathLiterals = [];
walk(ast(mountTest), node => {
  if (node.type === 'RegExpLiteral') patterns.push(node);
  if (node.type === 'StringLiteral' && node.value.startsWith('../../../../../backend/src/')) pathLiterals.push(node);
});
assert.equal(patterns.length, 2); assert.equal(pathLiterals.length, 2);
const appPattern = patterns.find(n => n.pattern.startsWith('app'));
const routerPattern = patterns.find(n => n.pattern.startsWith('router'));
assert.ok(appPattern && routerPattern);
const routerFiles = ledger.files.filter(f => f.path.startsWith(routerRoot) && !f.path.slice(routerRoot.length).includes('/') && f.path.endsWith('.mjs'));
const actualRouterPaths = fs.readdirSync(path.join(root, routerRoot)).filter(f => f.endsWith('.mjs')).map(f => routerRoot + f).sort();
assert.deepEqual(actualRouterPaths, routerFiles.map(f => f.path).sort(), 'Original predicate directory differs from protected population');
assert.equal(routerFiles.length, 191);
const baselineRouters = routerFiles.map(f => ({ path: f.path, text: source(f.path) }));
const candidateRouters = baselineRouters.map(f => ({ ...f, path: destination(f.path) }));
const movedRouters = routerFiles.filter(f => destination(f.path) !== f.path).map(f => ({ path: f.path, destination: destination(f.path), sha256: f.sha256 }));
assert.equal(movedRouters.length, 2);
const movedRouter = 'modules/gratitude/server/api/v1/gratitude.mjs';
const movedTest = 'modules/gratitude/server/api/v1/gratitude.card.test.mjs';
assert.deepEqual(movedRouters.map(f => f.destination).sort(), [movedTest, movedRouter].sort());
const offenders = files => files.filter(f => new RegExp(routerPattern.pattern, routerPattern.flags).test(f.text)).map(f => f.path).sort();
const oldFolderOnly = files => offenders(files.filter(f => f.path.startsWith(routerRoot)));
const injectMount = (files, target) => {
  assert.equal(files.filter(f => f.path === target).length, 1);
  return files.map(f => f.path === target ? { ...f, text: f.text + '\nrouter.use(requestLoggerMiddleware());\n' } : f);
};
// Proposed inventory adapter, not a replacement product assertion: require the
// explicitly selected target population before using the original regex.
function expandedGuard(files, expectedPaths) {
  const paths = files.map(f => f.path);
  if (paths.length !== expectedPaths.length || new Set(paths).size !== paths.length || expectedPaths.some(p => !paths.includes(p))) return 'population-mismatch';
  return offenders(files);
}
const expectedPaths = candidateRouters.map(f => f.path);
const appSource = source(appPath), appRegex = new RegExp(appPattern.pattern, appPattern.flags);
const appMatch = appSource.match(appRegex); assert.ok(appMatch);
const retargetedApp = editedFiles.find(f => f.path === appPath);
assert.ok(retargetedApp);
let proposedApp = appSource;
for (const e of edits.filter(e => e.path === appPath).sort((a, b) => b.start - a.start)) proposedApp = proposedApp.slice(0, e.start) + e.after + proposedApp.slice(e.end);
const guardObservations = [
  { id: 'original-global-mount', actual: appRegex.test(appSource), expected: true },
  { id: 'import-retarget-preserves-global-predicate', actual: appRegex.test(proposedApp), expected: true },
  { id: 'missing-global-mount-rejected', actual: appRegex.test(appSource.replace(appMatch[0], 'removed-mount(')), expected: false },
  { id: 'original-folder-no-double-mount', actual: oldFolderOnly(baselineRouters), expected: [] },
  { id: 'projected-old-folder-no-double-mount', actual: oldFolderOnly(candidateRouters), expected: [] },
  { id: 'old-folder-misses-relocated-duplicate', actual: oldFolderOnly(injectMount(candidateRouters, movedRouter)), expected: [] },
  { id: 'expanded-population-catches-relocated-duplicate', actual: expandedGuard(injectMount(candidateRouters, movedRouter), expectedPaths), expected: [movedRouter] },
  { id: 'expanded-population-retains-old-router-check', actual: expandedGuard(injectMount(candidateRouters, routerRoot + 'fitness.mjs'), expectedPaths), expected: [routerRoot + 'fitness.mjs'] },
  { id: 'expanded-population-retains-colocated-test-check', actual: expandedGuard(injectMount(candidateRouters, movedTest), expectedPaths), expected: [movedTest] },
  { id: 'missing-population-member-rejected', actual: expandedGuard(candidateRouters.filter(f => f.path !== movedRouter), expectedPaths), expected: 'population-mismatch' },
  { id: 'duplicate-population-member-rejected', actual: expandedGuard([...candidateRouters, candidateRouters[0]], expectedPaths), expected: 'population-mismatch' },
  { id: 'restored-expanded-population', actual: expandedGuard(candidateRouters, expectedPaths), expected: [] },
];
for (const observation of guardObservations) assert.deepEqual(observation.actual, observation.expected, observation.id);
const mountGuard = {
  test: mountTest, app: appPath, routerRoot,
  predicates: patterns.map(n => ({ line: n.loc.start.line, start: n.start, end: n.end, pattern: n.pattern, flags: n.flags, original: source(mountTest).slice(n.start, n.end) })),
  pathInputs: pathLiterals.map(n => ({ line: n.loc.start.line, start: n.start, end: n.end, value: n.value })),
  originalPopulation: routerFiles.map(f => ({ path: f.path, sha256: f.sha256 })),
  proposedPopulation: routerFiles.map(f => ({ original: f.path, path: destination(f.path), sha256: f.sha256 })),
  moved: movedRouters, retained: 189, observations: guardObservations,
  decision: 'The global mount predicate and app path remain valid for selected import edits. The old flat router directory loses two moved entries, including the real Gratitude router. Preserve all 191 original inspected artifacts through explicit baseline/candidate target enumeration; do not silently drop colocated tests, use an exists-based fallback or accept missing/duplicate paths.',
  remaining: 'Exact original-test target-provider/runner edit belongs to IMP-BASE.03 and IMP-SHARED.04.3 after candidate-selectable driver design. Check actual candidate bytes, not these baseline-text path projections. The regex still only sees this direct spelling; nested/helper/alias/computed mounting and runtime exactly-once behavior need separate assembly/contract checks.',
  limit: 'Twelve extracted source-predicate/population observations, not original Vitest execution, product runtime mutations or a candidate tree. Existing source and assertions unchanged.',
};
// Extract only the inspected pure predicate/helpers, never evaluate the suite or
// its top-level filesystem traversal. The helper's read is a protected-source map.
let schoolPredicate;
walk(ast(schoolGuardFile), node => {
  if (node.type === 'ArrowFunctionExpression' && node.params.length === 1 && node.params[0].type === 'ObjectPattern' && source(schoolGuardFile).slice(node.start, node.end).includes(originalPermission)) {
    assert.ok(!schoolPredicate, 'Ambiguous School HTTP filter'); schoolPredicate = node;
  }
});
assert.ok(schoolPredicate);
const schoolHelpers = Object.fromEntries(ast(schoolGuardFile).program.body.filter(n => n.type === 'FunctionDeclaration' && ['importsFrom', 'inside', 'resolveImport'].includes(n.id.name)).map(n => [n.id.name, source(schoolGuardFile).slice(n.start, n.end)]));
assert.equal(Object.keys(schoolHelpers).length, 3);
const helperFactory = new Function('readFileSync', 'path', `${Object.values(schoolHelpers).join('\n')}\nreturn { importsFrom, inside, resolveImport };`);
const helpers = helperFactory(file => source(path.relative(root, file)), path);
const originalPredicateText = source(schoolGuardFile).slice(schoolPredicate.start, schoolPredicate.end);
assert.equal(originalPredicateText.split(originalPermission).length, 2);
const proposedPredicateText = originalPredicateText.replace(originalPermission, referenceChanges[0].after);
const makePredicate = text => new Function('path', 'ROOT', 'inside', 'resolveImport', `return (${text});`)(path, root, helpers.inside, helpers.resolveImport);
const originalPredicate = makePredicate(originalPredicateText), proposedPredicate = makePredicate(proposedPredicateText);
const schoolRouter = 'backend/src/4_api/v1/routers/schoolCalc.mjs', schoolHandlers = 'backend/src/4_api/v1/handlers/schoolcalc';
const schoolPaths = ledger.files.filter(f => (f.path === schoolRouter || f.path.startsWith(schoolHandlers + '/')) && f.path.endsWith('.mjs') && !f.path.endsWith('.test.mjs')).map(f => f.path).sort();
const enumerateSchool = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(item => {
  const file = directory + '/' + item.name;
  assert.ok(!item.isSymbolicLink(), 'Unreviewed School corpus symlink');
  return item.isDirectory() ? enumerateSchool(file) : file.endsWith('.mjs') && !file.endsWith('.test.mjs') ? [file] : [];
});
assert.deepEqual([schoolRouter, ...enumerateSchool(schoolHandlers)].sort(), schoolPaths);
const schoolImports = helpers.importsFrom(schoolPaths.map(p => path.join(root, p)));
const schoolCandidateImports = schoolImports.map(e => ({ ...e, specifier: e.specifier === '#system/http/middleware/index.mjs' ? entry : e.specifier }));
const schoolObservations = [];
const observe = (id, actual, expected) => { assert.deepEqual(actual, expected, id); schoolObservations.push({ id, actual, expected }); };
const violations = (predicate, items) => items.filter(predicate).map(e => ({ path: path.relative(root, e.file), specifier: e.specifier }));
observe('school-original-corpus', violations(originalPredicate, schoolImports), []);
const changedSchoolImports = schoolCandidateImports.filter((e, i) => e.specifier !== schoolImports[i].specifier);
assert.equal(changedSchoolImports.length, 1);
observe('school-old-predicate-rejects-new-entry', violations(originalPredicate, schoolCandidateImports), changedSchoolImports.map(e => ({ path: path.relative(root, e.file), specifier: e.specifier })));
observe('school-proposed-predicate-baseline', violations(proposedPredicate, schoolImports), []);
observe('school-proposed-predicate-candidate', violations(proposedPredicate, schoolCandidateImports), []);
const forbiddenSchoolImports = ['@daylight/platform/server/system/http/middleware/errorHandler', '@daylight/platform/server/system/http/middleware-extra', '@daylight/platform/server/system/logging/logger', privateEntry, '@daylight/platform/server/system/utils/file-io', '#apps/school/UseCase.mjs', '#domains/school/Entity.mjs', 'node:fs', '../../../../../platform/server/system/http/middleware/index.mjs', '../../../3_applications/school/UseCase.mjs'];
for (const specifier of forbiddenSchoolImports) {
  const item = { file: path.join(root, schoolRouter), specifier };
  observe('school-forbidden-' + schoolObservations.length, [originalPredicate(item), proposedPredicate(item)], [true, true]);
}
for (const specifier of ['express', '#system/http/middleware/index.mjs', '../handlers/schoolcalc/retained.mjs']) {
  const item = { file: path.join(root, schoolRouter), specifier };
  observe('school-retained-' + schoolObservations.length, [originalPredicate(item), proposedPredicate(item)], [false, false]);
}
observe('school-restored-corpus', violations(proposedPredicate, schoolCandidateImports), []);
const schoolGuard = { test: schoolGuardFile, editId: referenceChanges[0].id, start: schoolPredicate.start, end: schoolPredicate.end, original: originalPredicateText, proposed: proposedPredicateText, helpers: schoolHelpers, population: schoolPaths.map(p => ({ path: p, sha256: sha(source(p)) })), imports: schoolImports.map(e => ({ path: path.relative(root, e.file), specifier: e.specifier })), observations: schoolObservations, rule: 'Only the exact old middleware entry or selected public replacement joins express and same-API-relative imports. Preserve the existing family/wire/construction predicates and every assertion. This spelling repair does not replace semantic export/LoA enforcement.', limits: 'Extracted original importsFrom/inside/resolveImport helpers and one pure filter, evaluated over protected corpus text and projected import strings. Not whole original-suite execution, relocated candidate bytes or a product mutation pair. Other SchoolCalc root/domain/adapter/utility rules remain separate prerequisites.' };
const scan = { protected: 0, regularText: 0, binary: 0, symlinks: 0 }, references = [];
const pattern = /http\/middleware|\b(?:requestLoggerMiddleware|tracingMiddleware|errorHandlerMiddleware|asyncHandler)\b/g;
for (const file of ledger.files.filter(f => f.protected)) {
  scan.protected++;
  if (file.mode === '120000') { scan.symlinks++; continue; }
  const bytes = fs.readFileSync(path.join(root, file.path)); assert.equal(sha(bytes), file.sha256);
  let text;
  try { if (bytes.includes(0) && !/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file.path)) throw new Error('binary'); text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { scan.binary++; continue; }
  scan.regularText++;
  const matches = [...text.matchAll(pattern)]; if (!matches.length) continue;
  source(file.path);
  const tree = file.path.endsWith('.mjs') ? ast(file.path) : null, nodes = [];
  if (tree) walk(tree, n => { if (['Identifier', 'StringLiteral', 'RegExpLiteral'].includes(n.type)) nodes.push(n); });
  for (const match of matches) {
    const start = match.index, end = start + match[0].length, line = text.slice(0, start).split('\n').length;
    const edit = edits.find(e => e.path === file.path && e.start <= start && e.end >= end);
    const node = nodes.filter(n => n.start <= start && n.end >= end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
    const comment = tree?.comments?.find(c => c.start <= start && c.end >= end);
    let disposition;
    if (edit) disposition = 'exact import/reference edit';
    else if (file.path === mountTest && node?.type === 'RegExpLiteral') disposition = 'retained mount predicate with separately specified complete mapped population';
    else if (node?.type === 'Identifier') disposition = 'retained JavaScript identifier; local/export/call names unchanged, path edges handled separately';
    else if (comment) disposition = 'retained source/JSDoc explanation or logical module label, not an import or source-file locator';
    else if (node?.type === 'StringLiteral' && !match[0].includes('/')) disposition = 'retained test description; no resolver or path change';
    else if (file.path.startsWith('docs/') && !file.path.startsWith('docs/reference/')) disposition = 'retained historical plan/audit/roadmap example, not executed runtime';
    else if (file.path === 'frontend/src/modules/AppContainer/Apps/Implementation.md') disposition = 'pre-existing stale mixed middleware recipe; do not rewrite to four-name facade that lacks its webhook exports';
    else if (file.path === 'docs/reference/core/network-exposure.md' && line === 474) disposition = 'pre-existing missing devProxy.mjs reference; no such selected source file or invented move';
    else if (file.path.startsWith('docs/reference/') && !match[0].includes('/')) disposition = 'retained function-name guidance; rules and names unchanged';
    else if (file.path === 'scripts/audit-baseline.vitest.txt' || file.path === 'logs/logging-audit-issues.json') disposition = 'retained historical failure/observability record, not runtime selection';
    assert.ok(disposition, 'Unreviewed HTTP reference: ' + file.path + ':' + line + ' ' + match[0]);
    references.push({ id: 'HTTPREF-' + sha(file.path + ':' + start).slice(0, 16), path: file.path, line, start, end, token: match[0], disposition, ...(edit ? { editId: edit.id } : {}) });
  }
}
assert.equal(new Set(references.filter(r => r.editId).map(r => r.editId)).size, edits.length);
emit('http-boundary.json', {
  schema: 'daylight.preimplementation.http-boundary/v1', baseline: ledger.baseline,
  status: 'Selected four-file system boundary, one four-name public entry, exact import/reference edits and separately indexed eleven-file native fixture; full installed package, caller/layer enforcement, computed references and original consumer parity remain gated',
  files, facade, defaultExports, edges: edgeDispositions, edits, editedFiles, mountGuard, schoolGuard, scan, references,
  dynamicImports: dynamic.map(e => ({ edgeId: e.id, path: e.from, line: e.line, selectedName: 'errorHandlerMiddleware', preserve: 'Await remains at the existing beforeAll point; no eager import rewrite' })),
  packageFragments: { public: { exports: { './server/system/http/middleware': './server/system/http/middleware.mjs' }, dependencies: { '@daylight-internal/platform--server': '0.0.0' } }, server: { exports: { './system/http/middleware': './system/http/middleware/index.mjs' }, dependencies: { uuid: backendManifest.dependencies.uuid } } },
  originalLoadingClosure: { files: [...closure].sort(), packageEdges, limits: 'Original resolved-source closure; package records are current require-condition projections, not native ESM or full installation proof' },
  loadingDecision: 'Keep the original cohesive private barrel: production callers already load all three leaves. Three original leaf-importing test files gain that aggregate loading closure when retargeted; record and verify it, do not claim unchanged test loading or use mixed-layer barrels.',
  priorSpecificationEdits: integrationEdits,
  loggingBoundary: { candidates: ['backend/src/0_system/logging/logger.mjs', 'backend/src/0_system/logging/dispatcher.mjs', 'backend/src/0_system/logging/localTimestamp.mjs'], status: 'Separate public/export/state decision, not implicitly approved by HTTP', preserve: ['Two module-created HTTP loggers retain their sampling state and runtime hostname capture', 'Logger looks up dispatcher at log call time; no per-owner dispatcher initialization or transport binding', 'Any LogDispatcher constructor with timezone changes module-global timezone, while resetLogging does not clear it', 'Logger stamps runtime-zone timestamps; dispatcher applies configured timezone only if event.ts is absent; neither becomes D8 nowTs nor D4 pure time', 'Retained logging/index.mjs re-exports resetLogging and configuration/transport utilities; do not publish it wholesale or expose test controls merely to make that barrel resolve'] },
  contracts: [
    { id: 'HTTP-ASYNC', names: ['asyncHandler'], preserve: 'Returns Promise.resolve(fn(...)).catch(next); fn executes before Promise.resolve, so a synchronous throw escapes synchronously rather than becoming next(error)' },
    { id: 'HTTP-ERROR', names: ['errorHandlerMiddleware'], preserve: 'Keep object/string shape differences, webhook envelopes/status, name versus class checks, finite explicit status precedence, headersSent handling only in string mode and trace ID fallbacks' },
    { id: 'HTTP-REQUEST-LOG', names: ['requestLoggerMiddleware'], preserve: 'Attach finish/close before next, exactly-once recorded flag, aborted based on writableEnded, status>=400/aborted warn bypass, success sampling, path grouping/device provenance and no request body' },
    { id: 'HTTP-TRACE', names: ['tracingMiddleware'], preserve: 'Truthy x-trace-id forwarded unchanged; falsy value mints uuidv4, assigns request then header then next; no new normalization' },
  ],
  verification: { originalErrorCases: 10, supportingLoggingCases: 54, dedicatedMiddlewareCases: 37, middlewarePopulation: { async: 6, tracing: 4, requestLogging: 12, errorHandling: 15 }, source: 'fixtures/server-foundation.json and fixtures/http-middleware.json; actual current receipts and four HTTP red/restored pairs in evidence-index.json', controlledMutations: { 'http-async-rejection': ['CASE-HTTP-ASYNC-RESOLVE', 'CASE-HTTP-ASYNC-REJECTION', 'CASE-HTTP-ASYNC-NEXT-THROWS'], 'http-duplicate-response': ['CASE-HTTP-LOG-ONCE'], 'http-trace-overwrite': ['CASE-HTTP-TRACE-PRESERVE'], 'http-private-fields': ['CASE-HTTP-LOG-PRIVACY'] }, limitations: '47 direct HTTP cases (10 original plus 37 dedicated) and 54 supporting logging cases do not prove full HTTP assembly. Dedicated cases use response/event doubles and real dispatcher with memory-only transport; status/json observations and JSON serialization are not actual Express invalid-status enforcement, socket/header state or native relocated UUID/error-class resolution. Existing requestLogger test opens listeners and reads fixed source paths; it was inspected but not executed. Matrix rows within a case are not additional discovered cases.', next: ['Selected eleven-file/nine-facade native fixture is indexed as http-identity; the same 37 dedicated and 64 original cases pass twice with exact import-only changes, preserving named populations, local bindings and prelude/body hashes. Error-string leaf-to-barrel loading is covered; verify the other two leaf suites, remaining consumers and full installed candidate identity', 'Preserve actual original requestLogger/school socket-suite populations and source-path assertions through separately safe verification', 'Finish computed/untracked references, original mock/suite parity and package/layer adoption, then full relocation and global middleware-order proof'] },
  inputs: [...inputs.values()], inventoryInputs: inventoryNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })), toolHash: sha(fs.readFileSync(new URL(import.meta.url))),
  limits: ['No production files moved or rewritten; source/guide edits and facade parsed only in memory', 'One public system entry does not authorize application/domain HTTP or filesystem mechanics', 'Literal HTTP path and four-name census covers all protected text; split/computed/untracked operator references remain global gates, and references are not runtime call coverage', 'No whole-controller, network, private records, transport activation or original socket-suite execution'],
});
process.stdout.write(JSON.stringify({ files: files.length, publicNames: names.length, sourceEdges: allEdges.length, imports: 82, referenceEdits: referenceChanges.length + 3, editGroups: edits.length, editedFiles: editedFiles.length, originalClosure: closure.size, dynamicImports: dynamic.length, utilityOverlaps: integrationEdits.length, mountPredicatePopulation: routerFiles.length, movedFromPredicatePopulation: movedRouters.length, guardObservations: guardObservations.length, schoolPopulation: schoolPaths.length, schoolImports: schoolImports.length, schoolObservations: schoolObservations.length, references: references.length, referenceFiles: new Set(references.map(r => r.path)).size, scan }) + '\n');
