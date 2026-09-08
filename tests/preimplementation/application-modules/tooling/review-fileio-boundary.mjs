/** Exact source-only FileIO public-entry/import proposal; no product source edits. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { root, packet, emit } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { parse } = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const inventoryNames = ['storage-consumer-review.json', 'dependency-ledger.json', 'source-ledger.json', 'utility-boundary.json', 'utility-reference-review.json', 'fileio-mock-review.json', 'owner-boundaries.json', 'boundary-review.json'];
const [storage, graph, ledger, utility, references, mocks, owners, foundation] = inventoryNames.map(read);
const sourcePath = 'backend/src/0_system/utils/FileIO.mjs';
const mixed = 'backend/src/0_system/utils/index.mjs';
const implementation = 'platform/server/system/utils/FileIO.mjs';
const entry = '@daylight/platform/server/system/utils/file-io';
const privateEntry = '@daylight-internal/platform--server/system/utils/file-io';
const texts = new Map(), trees = new Map(), inputs = new Map();
function source(file) {
  if (!texts.has(file)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const digest = sha(text);
    assert.equal(digest, ledger.files.find(f => f.path === file)?.sha256, 'Changed protected input: ' + file);
    texts.set(file, text); inputs.set(file, { path: file, sha256: digest });
  }
  return texts.get(file);
}
function ast(file) {
  if (!trees.has(file)) trees.set(file, parse(source(file), { sourceType: 'unambiguous', plugins: ['jsx', 'importAttributes'], allowReturnOutsideFunction: true }));
  return trees.get(file);
}
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'extra', 'comments', 'tokens', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, fn));
    else if (value && typeof value === 'object') walk(value, fn);
  }
}
const bindings = storage.consumers.flatMap(c => c.bindings.map(b => ({ ...b, path: c.path })));
const named = [...new Set(bindings.filter(b => b.origin !== '*').map(b => b.origin))].sort();
const privateOnly = storage.primitives.filter(p => !named.includes(p.name)).map(p => p.name).sort();
assert.equal(named.length, 73);
assert.deepEqual(privateOnly, ['createImageIO', 'findYamlByPrefix', 'isFile', 'resolveContainedYaml']);
assert.ok(storage.uses.every(u => u.origin !== '*'), 'Unresolved namespace use requires a public-surface decision');
const namespaces = bindings.filter(b => b.origin === '*').map(b => {
  const uses = storage.uses.filter(u => u.edgeId === b.edgeId);
  assert.ok(uses.every(u => named.includes(u.origin)));
  return { ...b, selectedNames: [...new Set(uses.map(u => u.origin))].sort(), uses: uses.map(u => ({ name: u.origin, kind: u.kind, source: u.source })) };
});
assert.equal(namespaces.length, 5);
assert.equal(namespaces.reduce((count, n) => count + n.uses.length, 0), 43);
const publicSymbols = named.map(name => {
  const primitive = storage.primitives.find(p => p.name === name);
  assert.ok(primitive);
  return { name, primitive, bindings: bindings.filter(b => b.origin === name), usedByNamespace: namespaces.filter(n => n.selectedNames.includes(name)).map(n => n.path), layer: 'system', owner: 'platform', runtime: 'server', rank: null, context: null };
});
const namespaceFactory = 'backend/src/1_adapters/fitness/YamlWorkoutRepository.test.mjs';
assert.ok(source(namespaceFactory).includes('...actual,') && source(namespaceFactory).includes('const actual = await importOriginal();'));
const namespacePolicy = {
  namedConsumers: 73, namespaceImports: 5, staticallySelectedNamespaceReferences: 43,
  allCurrentReferencesResolve: true,
  partialSpreadFactory: { path: namespaceFactory, meaning: 'Existing partial factory spreads importOriginal then overrides three used writer functions. No current source assertion observes the four private-only namespace properties; candidate namespace/key behavior remains an explicit test gate.' },
  preserve: 'No blanket namespace ban or eager destructuring rewrite. Keep existing namespace import/dynamic timing and property access; narrow public keys deliberately, never by accidental missing exports.',
};
const destination = file => owners.moves.find(m => m.old === file)?.new || foundation.files.find(f => f.path === file)?.proposedPath || file;
const edits = [], edgeDispositions = [];
const allEdges = graph.edges.filter(e => storage.carriers.some(c => c.file === e.target));
assert.equal(allEdges.length, 321);
for (const edge of allEdges) {
  if (edge.from === mixed) {
    assert.equal(edge.target, sourcePath);
    edgeDispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'removed with utility barrel by IMP-SHARED.04.1; no second FileIO edit' });
    continue;
  }
  if (edge.target === mixed) {
    const existing = utility.edgeDispositions.find(d => d.edgeId === edge.id);
    assert.ok(existing, 'Unaccounted mixed-barrel edge');
    assert.ok((existing.bindings || []).every(b => b.origin.file !== sourcePath), 'New filesystem-bearing barrel consumer needs review');
    edgeDispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'clock-only edge already specified in utility-boundary.json; no FileIO permission granted', utilityAction: existing.action });
    continue;
  }
  assert.equal(edge.target, sourcePath);
  let literal;
  walk(ast(edge.from), node => {
    const candidate = node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ? node.source : node.type === 'CallExpression' && node.callee.type === 'Import' ? node.arguments[0] : null;
    if (!candidate || candidate.value !== edge.specifier) return;
    const id = 'EDGE-' + sha(edge.from + ':' + node.start + ':' + candidate.value).slice(0, 16);
    if (id === edge.id) { assert.ok(!literal); literal = candidate; }
  });
  assert.ok(literal, 'Unmatched import ' + edge.id);
  const start = literal.start + 1, end = literal.end - 1;
  assert.equal(source(edge.from).slice(start, end), edge.specifier, 'Escaped literal needs explicit treatment');
  const testSource = storage.consumers.find(c => c.path === edge.from)?.role === 'test';
  assert.ok(testSource || !edge.from.startsWith('backend/src/2_domains/') && !edge.from.startsWith('backend/src/3_applications/') && !edge.from.startsWith('backend/src/4_api/') && !edge.from.startsWith('backend/src/5_composition/'), 'Forbidden production IO layer cannot be approved by retargeting: ' + edge.from);
  const id = 'FILEIO-IMPORT-' + edge.id.slice(5);
  edits.push({ id, edgeId: edge.id, path: edge.from, destination: destination(edge.from), line: literal.loc.start.line, start, end, before: edge.specifier, after: entry, kind: edge.syntax === 'dynamic-literal' ? 'lazy dynamic import specifier only' : 'static import specifier only' });
  edgeDispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'selected public FileIO import; factory/body unchanged', editId: id });
}
assert.equal(edits.length, 281);
for (const mock of mocks.mocks) {
  const before = source(mock.path).slice(mock.start, mock.end);
  assert.equal(sha(before), mock.mockCallSha256);
  let literal;
  walk(ast(mock.path), node => {
    if (node.type === 'CallExpression' && node.start === mock.start && node.end === mock.end) literal = node.arguments[0];
  });
  assert.equal(literal?.value, '#system/utils/FileIO.mjs');
  const start = literal.start + 1, end = literal.end - 1;
  assert.equal(source(mock.path).slice(start, end), literal.value);
  edits.push({ id: 'FILEIO-MOCK-' + sha(mock.path + ':' + start).slice(0, 16), path: mock.path, destination: destination(mock.path), line: literal.loc.start.line, start, end, before: literal.value, after: entry, kind: 'mock target only; retain factory and hoisting', gate: 'Existing subject imports and original assertion population must pass with the same public target; no private-reader exemption' });
}
assert.equal(edits.length, 303);
const groups = new Map();
for (const edit of edits) { if (!groups.has(edit.path)) groups.set(edit.path, []); groups.get(edit.path).push(edit); }
const editedFiles = [...groups].map(([file, changes]) => {
  let text = source(file), previous = text.length;
  for (const edit of [...changes].sort((a, b) => b.start - a.start)) {
    assert.ok(edit.end <= previous, 'Overlapping FileIO edits');
    assert.equal(text.slice(edit.start, edit.end), edit.before);
    text = text.slice(0, edit.start) + edit.after + text.slice(edit.end);
    previous = edit.start;
  }
  parse(text, { sourceType: 'unambiguous', plugins: ['jsx', 'importAttributes'], allowReturnOutsideFunction: true });
  return { path: file, sourceSha256: sha(source(file)), proposedSha256: sha(text), editIds: changes.map(e => e.id) };
});
const sourceText = `export { ${named.join(', ')} } from '${privateEntry}';\n`;
parse(sourceText, { sourceType: 'module' });
source(sourcePath);
const backendManifest = JSON.parse(source('backend/package.json'));
const facade = { entry, path: 'platform/public/server/system/utils/file-io.mjs', target: implementation, privateEntry, sourceText, sha256: sha(sourceText), names: named, owner: 'platform', category: 'platform', layer: 'system', runtime: 'server', context: null, rank: null };
const internalOnly = privateOnly.map(name => ({ name, disposition: 'Keep unchanged in the single private implementation; no named/bound namespace consumer in current source inventory. No deletion or new public promise.', internalDemand: name === 'findYamlByPrefix' ? 'Original loadYamlByPrefix calls it internally; public callers retain that behavior' : 'No source binding consumer inventoried; later dead-code analysis is a separate task' }));
const report = {
  schema: 'daylight.preimplementation.fileio-boundary/v1', baseline: ledger.baseline,
  status: 'Selected source/export/import proposal; native 73-name candidate, complete references and package adoption remain gated',
  implementation: { from: sourcePath, to: implementation, sha256: sha(source(sourcePath)), retainAllPrivateExports: 77, changeBody: false },
  facade, publicSymbols, internalOnly, namespaces, namespacePolicy,
  packageFragments: {
    public: { exports: { './server/system/utils/file-io': './server/system/utils/file-io.mjs' }, dependencies: { '@daylight-internal/platform--server': '0.0.0' } },
    server: { exports: { './system/utils/file-io': './system/utils/FileIO.mjs' }, dependencies: { axios: backendManifest.dependencies.axios, 'js-yaml': backendManifest.dependencies['js-yaml'] } },
    constraint: 'Fragments only. Preserve backend axios/js-yaml installed version/instance closure when these ranges are adopted; a fresh broad-range resolve is not equivalent to the existing lock graph.',
  },
  edges: edgeDispositions, edits, editedFiles,
  dynamicImports: references.constructions.filter(c => c.followup?.gate === 'FILEIO-DYNAMIC-IDENTITY').map(c => ({ edgeId: c.sourceEdgeId, path: c.path, line: c.line, editId: edits.find(e => e.edgeId === c.sourceEdgeId)?.id })),
  gates: [
    'FILEIO-REFERENCES: adjudicate all source/mock/architecture/doc/operator literals beyond this AST import scope; retain D5/D10 rulings and intentional old-path fixtures',
    'FILEIO-PACKAGE: full manifests/lock/native and runner resolution, original axios/js-yaml instance and browser exclusion',
    'FILEIO-MOCK-IDENTITY: original suites before/after selected 73-name facade with unchanged factories/namespace use; synthetic 77-name probe is not that proof',
    'FILEIO-COMBINED: compose these 303 edits with the existing five boundary specifications, actual moves, assets and build inputs',
    'FILEIO-STORAGE: complete retained namespace/callback/writer authority and behavioral coverage; no data move or concurrency upgrade',
    'FILEIO-LAYERS: existing D5/D10 and adapter guidance hold through facades; current raw-path/config/port violations remain separate prerequisites',
  ],
  inputs: [...inputs.values()], inventoryInputs: inventoryNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })),
  toolHash: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  limits: ['No code or existing test changed; all replacements applied and parsed only in memory', 'Selected public surface is demand-backed; no claim that a namespace is identical to the old 77-key implementation namespace', 'Source import census is not exhaustive runtime-generated operator/reference or installed dependency provenance'],
};
assert.equal(report.dynamicImports.length, 23);
assert.ok(report.dynamicImports.every(d => d.editId));
emit('fileio-boundary.json', report);
process.stdout.write(JSON.stringify({ publicNames: named.length, privateOnly: privateOnly.length, sourceEdges: allEdges.length, sourceImports: 281, mockTargets: 22, edits: edits.length, files: editedFiles.length, namespaces: namespaces.length, dynamicImports: report.dynamicImports.length }) + '\n');
