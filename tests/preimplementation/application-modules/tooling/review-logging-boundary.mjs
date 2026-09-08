/** Logging ownership/export/reference proposal; no product evaluation or edits. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { parse } = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const inventoryNames = ['source-ledger.json', 'dependency-ledger.json', 'boundary-review.json', 'owner-boundaries.json'];
const [ledger, graph, foundation, owners] = inventoryNames.map(n => JSON.parse(fs.readFileSync(path.join(packet, n))));
const prefix = 'backend/src/0_system/logging/';
const selected = ['logger.mjs', 'dispatcher.mjs', 'localTimestamp.mjs'].map(n => prefix + n);
const retired = prefix + 'index.mjs';
const inputs = new Map(), texts = new Map(), trees = new Map(), edits = [], dispositions = [];
function source(file) {
  if (!texts.has(file)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(sha(text), ledger.files.find(f => f.path === file)?.sha256, 'Protected source changed: ' + file);
    texts.set(file, text); inputs.set(file, { path: file, sha256: sha(text) });
  }
  return texts.get(file);
}
function ast(file) {
  if (!trees.has(file)) trees.set(file, parse(source(file), { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true }));
  return trees.get(file);
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
const metadata = { owner: 'platform', category: 'platform', runtime: 'server', layer: 'system', context: null, rank: null };
const facades = [
  { suffix: 'logger', target: 'logger.mjs', names: ['createLogger'], usage: 'runtime' },
  { suffix: 'dispatcher', target: 'dispatcher.mjs', names: ['getDispatcher', 'isLoggingInitialized', 'initializeLogging'], usage: 'runtime' },
  { suffix: 'local-timestamp', target: 'localTimestamp.mjs', names: ['formatLocalTimestamp'], usage: 'runtime' },
  { suffix: 'testing', target: 'dispatcher.mjs', names: ['LogDispatcher', 'LEVEL_PRIORITY', 'resetLogging'], usage: 'test-only' },
].map(f => {
  const entry = '@daylight/platform/server/system/logging/' + f.suffix;
  // Both dispatcher facades forward the same private implementation entry.
  const privateEntry = '@daylight-internal/platform--server/system/logging/' + (f.usage === 'test-only' ? 'dispatcher' : f.suffix);
  const sourceText = `export { ${f.names.join(', ')} } from '${privateEntry}';\n`;
  return { ...metadata, entry, privateEntry, path: 'platform/public/server/system/logging/' + f.suffix + '.mjs', target: destination(prefix + f.target), names: f.names, usage: f.usage, sourceText, sha256: sha(sourceText) };
});
const entryFor = name => { const matches = facades.filter(f => f.names.includes(name)); assert.equal(matches.length, 1); return matches[0]; };
const incoming = graph.edges.filter(e => selected.includes(e.target));
assert.equal(incoming.length, 37);
assert.equal(graph.edges.filter(e => e.target === retired).length, 0, 'Cannot retire a used aggregate');
for (const edge of incoming) {
  if (edge.from === retired) {
    dispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'Retire unused aggregate only after reference/candidate gates; no old-path forwarding facade' });
    continue;
  }
  const projectedFrom = destination(edge.from), projectedTarget = destination(edge.target);
  if (projectedFrom.startsWith('platform/server/') && edge.specifier.startsWith('.')) {
    assert.equal(path.posix.normalize(path.posix.join(path.posix.dirname(projectedFrom), edge.specifier)), projectedTarget);
    dispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, action: 'Private same-facet relative import unchanged; includes two HTTP module-created loggers' });
    continue;
  }
  assert.equal(edge.syntax, 'ImportDeclaration', 'Review non-static logging edge explicitly');
  let declaration;
  walk(ast(edge.from), node => {
    if (node.type === 'ImportDeclaration' && node.source.value === edge.specifier && 'EDGE-' + sha(edge.from + ':' + node.start + ':' + node.source.value).slice(0, 16) === edge.id) declaration = node;
  });
  assert.ok(declaration);
  const groups = new Map();
  for (const spec of declaration.specifiers) {
    assert.equal(spec.type, 'ImportSpecifier', 'No unreviewed default/namespace consumption');
    const facade = entryFor(spec.imported.name);
    if (facade.usage === 'test-only') assert.ok(edge.from.startsWith('tests/') || /\.(test|spec)\./.test(edge.from), 'Production use of test entry');
    if (!groups.has(facade.entry)) groups.set(facade.entry, []);
    groups.get(facade.entry).push(source(edge.from).slice(spec.start, spec.end));
  }
  let start, end, after;
  if (groups.size === 1) {
    start = declaration.source.start + 1; end = declaration.source.end - 1; after = [...groups.keys()][0];
  } else {
    start = declaration.start; end = declaration.end;
    assert.ok(!(ast(edge.from).comments || []).some(c => c.start >= start && c.end <= end), 'Do not discard import comments');
    after = [...groups].map(([entry, names]) => `import { ${names.join(', ')} } from '${entry}';`).join('\n');
  }
  const id = 'LOGGING-IMPORT-' + edge.id.slice(5);
  edits.push({ id, edgeId: edge.id, path: edge.from, destination: projectedFrom, line: declaration.loc.start.line, start, end, before: source(edge.from).slice(start, end), after, kind: groups.size > 1 ? 'split runtime/test-only import; preserve all local bindings' : 'import literal only' });
  dispositions.push({ edgeId: edge.id, from: edge.from, target: edge.target, editId: id, publicEntries: [...groups.keys()], action: 'Retarget exact named bindings; split test controls without changing assertions or timing' });
}
assert.equal(edits.length, 30);
const referenceChanges = [
  ['CLAUDE.md', 421, '0_system/logging/logger.mjs', facades[0].entry],
  ['backend/src/3_applications/scan/ScanIngressCoordinator.mjs', 169, 'backend/src/0_system/logging/logger.mjs', facades[0].entry],
];
for (const [file, line, before, after] of referenceChanges) {
  const text = source(file), lineStart = text.split('\n').slice(0, line - 1).join('\n').length + 1;
  const start = text.indexOf(before, lineStart);
  assert.ok(start >= lineStart && start < lineStart + text.split('\n')[line - 1].length);
  edits.push({ id: 'LOGGING-REFERENCE-' + (file === 'CLAUDE.md' ? 'GUIDE' : 'SCAN'), path: file, destination: destination(file), line, start, end: start + before.length, before, after, kind: 'Spelling-only source link; no guidance or sampling behavior change' });
}
const scan = { protected: 0, regularText: 0, binary: 0, symlinks: 0 }, references = [];
const pattern = /(?:logger|dispatcher|localTimestamp)\.mjs|logging\/index\.mjs|#system\/logging(?=['"`\s])/g;
for (const file of ledger.files.filter(f => f.protected)) {
  scan.protected++;
  if (file.mode === '120000') { scan.symlinks++; continue; }
  const bytes = fs.readFileSync(path.join(root, file.path));
  assert.equal(sha(bytes), file.sha256);
  let text;
  try { if (bytes.includes(0) && !/\.(mjs|cjs|js|jsx|ts|tsx)$/.test(file.path)) throw new Error('binary'); text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { scan.binary++; continue; }
  scan.regularText++;
  for (const match of text.matchAll(pattern)) {
    source(file.path);
    const start = match.index, end = start + match[0].length, line = text.slice(0, start).split('\n').length;
    const edit = edits.find(e => e.path === file.path && e.start <= start && e.end >= end);
    const related = incoming.find(e => e.from === file.path && text.split('\n')[line - 1].includes(e.specifier));
    let disposition;
    if (edit) disposition = 'exact import or spelling edit';
    else if (file.path === retired) disposition = 'gated unused-aggregate retirement';
    else if (related) disposition = 'retained same-facet relative import';
    else if (file.path === prefix + 'dispatcher.mjs' || file.path === prefix + 'localTimestamp.mjs') disposition = 'retained sibling-name/history comment; original bodies unchanged';
    else if (file.path.startsWith('docs/') && !file.path.startsWith('docs/reference/')) disposition = 'retained historical plan/audit example, not active runtime';
    else if (file.path === 'frontend/src/modules/AppContainer/Apps/Implementation.md') disposition = 'unrelated historical browser _lib/logger example, not backend aggregate';
    assert.ok(disposition, 'Unreviewed logging reference: ' + file.path + ':' + line);
    references.push({ id: 'LOGREF-' + sha(file.path + ':' + start).slice(0, 16), path: file.path, line, start, end, token: match[0], disposition, ...(edit ? { editId: edit.id } : {}) });
  }
}
assert.equal(references.length, 91); assert.equal(new Set(references.map(r => r.path)).size, 42);
assert.equal(new Set(references.filter(r => r.editId).map(r => r.editId)).size, edits.length);
const editedFiles = [...new Set(edits.map(e => e.path))].sort().map(file => {
  let text = source(file), previous = text.length;
  for (const edit of edits.filter(e => e.path === file).sort((a, b) => b.start - a.start)) {
    assert.ok(edit.end <= previous); assert.equal(text.slice(edit.start, edit.end), edit.before);
    text = text.slice(0, edit.start) + edit.after + text.slice(edit.end); previous = edit.start;
  }
  if (file.endsWith('.mjs')) parse(text, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
  return { path: file, destination: destination(file), sourceSha256: sha(source(file)), proposedSha256: sha(text) };
});
for (const f of facades) parse(f.sourceText, { sourceType: 'module' });
const files = selected.map(file => ({ path: file, destination: destination(file), sha256: sha(source(file)), action: 'move one unchanged body', ...metadata }));
const publicExports = Object.fromEntries(facades.map(f => [f.entry.replace('@daylight/platform', '.'), './' + f.path.replace('platform/public/', '')]));
const serverExports = Object.fromEntries(facades.filter(f => f.usage === 'runtime').map(f => [f.privateEntry.replace('@daylight-internal/platform--server', '.'), './' + f.target.replace('platform/server/', '')]));
emit('logging-boundary.json', {
  schema: 'daylight.preimplementation.logging-boundary/v1', baseline: ledger.baseline,
  status: 'Selected three-body/four-entry source and test-visibility design; native fixture, full package/consumer/enforcement gates remain separate',
  files, facades, edges: dispositions, edits, editedFiles, scan, references,
  retirement: { path: retired, sha256: sha(source(retired)), incomingSourceEdges: 0, removedOutgoingEdges: graph.edges.filter(e => e.from === retired).map(e => e.id), action: 'Retire only this unused aggregate after full reference and candidate gates. Configuration, utilities and transports remain at their current locations; no old forwarding shim or unrelated cleanup.', preservedLeafExports: selected.map(file => ({ path: file, names: graph.exports.filter(e => e.from === file).map(e => e.name) })) },
  packageFragments: { public: { exports: publicExports, dependencies: { '@daylight-internal/platform--server': '0.0.0' } }, server: { exports: serverExports, dependencies: {} } },
  visibility: { testEntry: facades[3].entry, rule: 'Metadata/enforcement admits only test consumers, including through re-export chains; production and runtime barrels must be rejected. Node package exports are not an access-control mechanism.', privateRule: 'Owner/facet internals retain relative imports; cross-owner private imports remain prohibited. Both dispatcher facades forward one private module, not separate copies.', defaults: 'All three default aliases remain private and unchanged; no current caller demands public defaults.' },
  stateContracts: [
    { id: 'LOG-STATE-ONE', preserve: 'One dispatcher binding and globalTimezone variable per canonical server module; private/public/test entries must share them.' },
    { id: 'LOG-STATE-LOOKUP', preserve: 'A logger created before initialize/reset/reinitialize resolves the current dispatcher at each log call. Each createLogger/child gets its own sampling Map; resetLogging does not clear existing maps.' },
    { id: 'LOG-STATE-TIME', preserve: 'Any LogDispatcher constructor with a truthy timezone changes module globalTimezone; resetLogging leaves it, and a constructor without timezone keeps it. Logger stamps runtime-zone ts before dispatch; direct events without truthy ts use dispatcher globalTimezone. Neither formatter becomes D4 pure time or D8 household nowTs.' },
    { id: 'LOG-STATE-LIFETIME', preserve: 'initializeLogging replaces without flush/disposal. resetLogging starts flush, swallows rejection and clears singleton synchronously without awaiting. flush catches rejected transport promises but a synchronous throw/non-promise may reject the whole flush; do not repair these semantics in a move.' },
    { id: 'LOG-STATE-TRANSPORT', preserve: 'Synchronous send failures increment errors and do not prevent later transports; async send rejection is not awaited. Metrics/status objects, mutable LEVEL_PRIORITY, context snapshots and fallback stdout/stderr channels keep current behavior.' },
    { id: 'LOG-STATE-SAMPLING', preserve: 'Per-logger/per-event 60-second windows; summary only on a later sampled call, using that call level/aggregate option. No reset-time flush, new timers or cross-owner shared sampling budget.' },
  ],
  verification: { existingLoggingCases: 54, existingErrorCases: 10, evidence: 'Current server-foundation receipt in evidence-index.json; unchanged original baseline only', next: ['Native twelve-probe/five-step fixture delivered separately; complete original-suite candidate and full installation identity', 'Runtime test-facade import and re-export rejection through actual future enforcement', 'Same original affected suites after split imports, including retained ingestion/session transports/API status and CLI', 'Full package/lock/build/controller/consumer and field/privacy behavior; no real transport activation in preparation'] },
  inputs: [...inputs.values()], inventoryInputs: inventoryNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })), toolHash: sha(fs.readFileSync(new URL(import.meta.url))),
  limits: ['No existing code, test, guide, manifest or alias changed. Facades/imports are parsed in memory; retirement is specified, not performed.', 'Text census covers the stated literal spellings in all protected text; split/computed/untracked operator references remain explicit global gates.', 'Three original source files use only relative source imports and Node os. This does not certify the separate retained transport/configuration/provider loading closures.', 'No browser logger unification, new port, transport, SDK API or logging behavior change. Existing guideline examples are not authority to change actual timestamp defaults.'],
});
process.stdout.write(JSON.stringify({ files: files.length, facades: facades.length, runtimeNames: facades.filter(f => f.usage === 'runtime').flatMap(f => f.names).length, testNames: facades[3].names.length, edges: incoming.length, edits: edits.length, editedFiles: editedFiles.length, references: references.length, referenceFiles: new Set(references.map(r => r.path)).size, scan, retiredIncoming: 0 }) + '\n');
