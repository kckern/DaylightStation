/** Read-only FileIO text-reference census and extracted structural-guard experiment. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, packet, emit } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { parse } = createRequire(path.join(process.env.PRE_TOOLCHAIN_ROOT, 'package.json'))('@babel/parser');
const inventoryNames = ['source-ledger.json', 'fileio-boundary.json', 'utility-boundary.json', 'utility-reference-review.json'];
const [ledger, io, utility, utilityRefs] = inventoryNames.map(n => JSON.parse(fs.readFileSync(path.join(packet, n))));
const inputMap = new Map(), texts = new Map(), trees = new Map();
const scan = { protected: 0, regularText: 0, binary: 0, symlinks: 0, matchingFiles: 0, parsedMatchingFiles: 0 };
const refs = [], unknown = [];
const isJS = name => /\.(mjs|cjs|js|jsx|ts|tsx)$/.test(name);
const rulesPath = 'scripts/audit-layer-imports.mjs';
const structuralTest = 'backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.test.mjs';
const structuralSubject = 'backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.mjs';
const namespacePaths = new Set(io.namespaces.map(n => n.path));
const retired = new Set(utility.files.filter(f => f.action.startsWith('retire')).map(f => f.path));
const legacyFixtures = new Set(['tests/unit/tooling/auditLayerImports.test.mjs', 'tests/unit/tooling/auditDirectFsImports.test.mjs']);
const diagnosticRefs = new Set([
  'backend/src/0_system/utils/FileIO.mjs:16',
  'backend/src/1_adapters/cost/YamlCostDatastore.test.mjs:14',
  structuralTest + ':671',
  'tests/isolated/api/health-dashboard-router.test.mjs:135',
  'tests/unit/tooling/auditLayerImports.test.mjs:73',
]);
const policies = {
  'FILEIO-IMPORT': 'Existing import/mock replacement in fileio-boundary.json; do not duplicate edits.',
  'FILEIO-UTILITY': 'Separate FileIOError constructor/export demand is already under utility-boundary.json; not a FileIO filesystem binding.',
  'FILEIO-RETIRE': 'Reference disappears only with the separately gated utility/error barrel retirement.',
  'FILEIO-NAMESPACE': 'Retain original namespace identifier/property access and timing; five namespaces and 43 bound property uses are in fileio-boundary.json.',
  'FILEIO-ERROR-TYPE': 'FileIOError is a distinct unchanged class/name, not a file path to the filesystem implementation.',
  'FILEIO-RULING': 'Retain D5/D10 text verbatim. Existing and relocated/public paths must obey the same binding rules.',
  'FILEIO-REFERENCE': 'Live guidance path example needs a separately approved spelling-only change; semantics remain unchanged.',
  'FILEIO-HISTORY': 'Retain dated plan/audit/roadmap spelling as baseline evidence, not a runtime consumer or current execution instruction.',
  'FILEIO-COMMENT': 'Retain conceptual/behavioral comment or original source header; do not change the preserved FileIO body merely to refresh its header.',
  'FILEIO-SOURCE-LINK': 'Separately update a literal source-location comment alongside the affected import; no behavior change.',
  'FILEIO-LEGACY-FIXTURE': 'Keep old-path layer regression input. New public/new-root enforcement cases supplement it under IMP-BASE.02.',
  'FILEIO-ENFORCEMENT': 'Three current rule regexes depend on old FileIO spellings; resolved-target enforcement with old/new/public/private cases is required under IMP-BASE.02, not an allowlist waiver.',
  'FILEIO-CORPUS-GUARD': 'Existing source-inspection regex fails after the selected import edit; proposed exact old-or-public matcher preserves allowed symbols and forbidden filesystem operations.',
  'FILEIO-DIAGNOSTIC': 'Retain diagnostic label, test title or error name; spelling is not a resolver input.',
};
function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'tokens', 'extra', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, fn));
    else if (value && typeof value === 'object') walk(value, fn);
  }
}
const sourceLinkChanges = new Map([
  ['backend/src/1_adapters/persistence/yaml/YamlComposerSongStore.mjs:122', ['backend/src/0_system/utils/FileIO.mjs', io.facade.entry]],
  ['backend/src/1_adapters/persistence/yaml/YamlLessonCompanionStore.mjs:12', ['#system/utils/FileIO.mjs', io.facade.entry]],
  ['backend/src/1_adapters/persistence/yaml/YamlReadingLogStore.mjs:58', ['#system/utils/FileIO.mjs', io.facade.entry]],
]);
const docChanges = new Map([
  ['docs/reference/core/adapter-layer-guidelines.md:81', ['0_system/utils/FileIO', io.facade.entry]],
  ['docs/reference/core/adapter-layer-guidelines.md:114', ['#system/utils/FileIO', io.facade.entry]],
  ['docs/reference/core/adapter-layer-guidelines.md:424', ['#system/utils/FileIO', io.facade.entry]],
]);
const edits = [];
for (const file of ledger.files.filter(f => f.protected)) {
  scan.protected++;
  if (file.mode === '120000') { scan.symlinks++; continue; }
  const bytes = fs.readFileSync(path.join(root, file.path));
  assert.equal(sha(bytes), file.sha256, 'Protected input differs: ' + file.path);
  let source;
  try {
    if (bytes.includes(0) && !isJS(file.path)) throw new Error('binary');
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { scan.binary++; continue; }
  scan.regularText++;
  if (!/FileIO|file-io/.test(source)) continue;
  scan.matchingFiles++; texts.set(file.path, source); inputMap.set(file.path, { path: file.path, sha256: sha(bytes) });
  let nodes = [], comments = [];
  if (isJS(file.path)) {
    const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', ...(/\.tsx?$/.test(file.path) ? ['typescript'] : []), 'decorators-legacy'], allowReturnOutsideFunction: true });
    trees.set(file.path, ast); scan.parsedMatchingFiles++; comments = ast.comments || [];
    walk(ast, node => nodes.push(node));
  }
  for (const match of source.matchAll(/FileIO|file-io/g)) {
    const start = match.index, end = start + match[0].length;
    const line = source.slice(0, start).split('\n').length;
    const containing = nodes.filter(n => n.start <= start && n.end >= end).sort((a, b) => a.end - a.start - (b.end - b.start));
    const comment = comments.find(c => c.start <= start && c.end >= end);
    const node = containing[0];
    const ioEdit = io.edits.find(e => e.path === file.path && e.start <= start && e.end >= end);
    const utilityEdit = [...utility.edits, ...utilityRefs.edits].find(e => e.path === file.path && e.start <= start && e.end >= end);
    const key = file.path + ':' + line;
    let policy, replacement = null;
    if (ioEdit) policy = 'FILEIO-IMPORT';
    else if (utilityEdit) policy = 'FILEIO-UTILITY';
    else if (retired.has(file.path)) policy = 'FILEIO-RETIRE';
    else if (file.path === 'docs/reference/core/layers-of-abstraction/decision-register.md') policy = 'FILEIO-RULING';
    else if (docChanges.has(key)) { policy = 'FILEIO-REFERENCE'; replacement = docChanges.get(key); }
    else if (sourceLinkChanges.has(key)) { policy = 'FILEIO-SOURCE-LINK'; replacement = sourceLinkChanges.get(key); }
    else if (file.path.endsWith('.md')) policy = file.path.startsWith('docs/reference/') ? 'FILEIO-COMMENT' : 'FILEIO-HISTORY';
    else if (comment) policy = 'FILEIO-COMMENT';
    else if (legacyFixtures.has(file.path) && node?.type === 'StringLiteral' && node.value.includes('FileIO.mjs')) policy = 'FILEIO-LEGACY-FIXTURE';
    else if (file.path === rulesPath && containing.some(n => n.type === 'RegExpLiteral')) policy = 'FILEIO-ENFORCEMENT';
    else if (file.path === structuralTest && containing.some(n => n.type === 'RegExpLiteral')) policy = 'FILEIO-CORPUS-GUARD';
    else if (node?.type === 'Identifier' && node.name === 'FileIO' && namespacePaths.has(file.path)) policy = 'FILEIO-NAMESPACE';
    else if ((node?.type === 'Identifier' && node.name === 'FileIOError') || (node?.type === 'StringLiteral' && node.value === 'FileIOError')) policy = 'FILEIO-ERROR-TYPE';
    else if (diagnosticRefs.has(key) && (node?.type === 'StringLiteral' || node?.type === 'TemplateElement')) policy = 'FILEIO-DIAGNOSTIC';
    const ref = { id: 'FREF-' + sha(file.path + ':' + start).slice(0, 16), path: file.path, line, start, end, token: match[0], context: comment ? 'comment' : node?.type || 'text', policy: policy || 'UNREVIEWED', ...(ioEdit ? { editId: ioEdit.id } : {}), ...(utilityEdit ? { relatedEdit: { path: utilityEdit.path, start: utilityEdit.start, end: utilityEdit.end } } : {}) };
    refs.push(ref);
    if (!policy) unknown.push(ref);
    if (replacement) {
      const [before, after] = replacement, lineStart = source.lastIndexOf('\n', start) + 1;
      const spanStart = source.indexOf(before, lineStart);
      assert.ok(spanStart >= lineStart && spanStart <= start && spanStart + before.length >= end, 'Source/doc replacement anchor changed');
      edits.push({ id: 'FILEIO-REF-EDIT-' + ref.id.slice(5), referenceId: ref.id, path: file.path, line, start: spanStart, end: spanStart + before.length, before, after, policy });
    }
  }
}
assert.equal(scan.protected, 13083); assert.equal(scan.matchingFiles, 388); assert.equal(refs.length, 778);
assert.equal(new Set(refs.filter(r => r.policy === 'FILEIO-IMPORT').map(r => r.editId)).size, io.edits.length, 'Import/mock reference coverage');
assert.equal(unknown.length, 0, 'Unreviewed FileIO occurrence: ' + JSON.stringify(unknown));
assert.equal(edits.length, 6);

// Extract the existing predicate as data; never evaluate the test, import its subject or read the corpus.
const testSource = texts.get(structuralTest), subject = texts.get(structuralSubject);
let guardNode, forbiddenNode;
walk(trees.get(structuralTest), node => {
  if (node.type === 'RegExpLiteral' && node.pattern.includes('FileIO')) { assert.ok(!guardNode); guardNode = node; }
  if (node.type === 'ForOfStatement' && node.left.declarations?.[0]?.id?.name === 'forbidden') forbiddenNode = node.right;
});
assert.ok(guardNode && forbiddenNode?.type === 'ArrayExpression');
const forbidden = forbiddenNode.elements.map(n => { assert.equal(n.type, 'StringLiteral'); return n.value; });
assert.deepEqual(forbidden, ['node:fs', "from 'fs'", 'readdir', 'listFiles', 'listEntries', 'listDirs', 'dirExists', 'listYamlFiles', 'statSync', 'globSync']);
const oldPattern = guardNode.pattern;
const oldToken = '#system\\/utils\\/FileIO\\.mjs';
assert.equal(oldPattern.split(oldToken).length, 2);
const publicToken = io.facade.entry.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const newPattern = oldPattern.replace(oldToken, '(?:' + oldToken + '|' + publicToken + ')');
const before = testSource.slice(guardNode.start, guardNode.end), after = '/' + newPattern + '/' + guardNode.flags;
assert.equal(before, '/' + oldPattern + '/' + guardNode.flags);
const subjectEdit = io.edits.find(e => e.path === structuralSubject);
assert.ok(subjectEdit); assert.equal(subject.slice(subjectEdit.start, subjectEdit.end), subjectEdit.before);
const proposedSubject = subject.slice(0, subjectEdit.start) + subjectEdit.after + subject.slice(subjectEdit.end);
function evaluate(source, pattern) {
  const imports = source.match(new RegExp(pattern, guardNode.flags));
  if (!imports) return 'FileIO import block';
  if (JSON.stringify(imports[1].split(',').map(n => n.trim()).filter(Boolean).sort()) !== JSON.stringify(['fileExists', 'loadYamlSafe'])) return 'allowed symbols';
  return forbidden.find(token => source.includes(token)) || 'passed';
}
const guardObservations = [
  { id: 'baseline-original', actual: evaluate(subject, oldPattern), expected: 'passed' },
  { id: 'retarget-only-red', actual: evaluate(proposedSubject, oldPattern), expected: 'FileIO import block' },
  { id: 'old-source-updated-predicate', actual: evaluate(subject, newPattern), expected: 'passed' },
  { id: 'public-source-updated-predicate', actual: evaluate(proposedSubject, newPattern), expected: 'passed' },
  { id: 'extra-symbol-rejected', actual: evaluate(proposedSubject.replace('  fileExists,', '  fileExists, loadYaml,'), newPattern), expected: 'allowed symbols' },
  { id: 'private-path-rejected', actual: evaluate(proposedSubject.replace(io.facade.entry, io.facade.privateEntry), newPattern), expected: 'FileIO import block' },
  ...forbidden.map(token => ({ id: 'forbidden-' + token, actual: evaluate(proposedSubject + '\n// ' + token, newPattern), expected: token })),
  { id: 'restored-public', actual: evaluate(proposedSubject, newPattern), expected: 'passed' },
];
for (const observation of guardObservations) assert.equal(observation.actual, observation.expected, observation.id);
edits.push({ id: 'FILEIO-CORPUS-GUARD-EDIT', path: structuralTest, line: guardNode.loc.start.line, start: guardNode.start, end: guardNode.end, before, after, policy: 'FILEIO-CORPUS-GUARD' });
const editedFiles = [...new Set(edits.map(e => e.path))].sort().map(file => {
  let source = texts.get(file), previous = source.length;
  for (const edit of edits.filter(e => e.path === file).sort((a, b) => b.start - a.start)) {
    assert.ok(edit.end <= previous); assert.equal(source.slice(edit.start, edit.end), edit.before);
    source = source.slice(0, edit.start) + edit.after + source.slice(edit.end); previous = edit.start;
  }
  if (isJS(file)) parse(source, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true });
  return { path: file, sourceSha256: sha(texts.get(file)), proposedSha256: sha(source) };
});
emit('fileio-reference-review.json', {
  schema: 'daylight.preimplementation.fileio-reference-review/v1', baseline: ledger.baseline,
  status: 'All matching tracked text occurrences classified; exact additional comment/example/structural-guard edits specified in memory. Global scanner and runtime-generated references remain separately gated.',
  scan, references: refs, unknown, policies: Object.entries(policies).map(([id, rule]) => ({ id, rule })), edits, editedFiles,
  guardExperiment: { subject: structuralSubject, test: structuralTest, subjectEditId: subjectEdit.id, originalPattern: oldPattern, proposedPattern: newPattern, forbidden, observations: guardObservations, limit: 'Extracted original regex and forbidden tokens exercised as string predicates, not original Vitest execution, product runtime, corpus access or a migrated candidate.' },
  inputs: [...inputMap.values()], inventoryInputs: inventoryNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })),
  toolHash: sha(fs.readFileSync(new URL(import.meta.url))),
  limits: ['Exact FileIO/file-io text census, not arbitrary split/computed/eval-generated names or untracked external scripts', 'Matching JS/TS files parsed; whole-tree 9273-source parse proof is separately recorded in utility-reference-review.json', 'Three old-spelling layer rule predicates and four old-path fixture occurrences keep explicit IMP-BASE.02 obligations; no production gate fixed or weakened', 'No existing file changed; all seven additional edits and guard probes remain in-memory preparation'],
});
process.stdout.write(JSON.stringify({ scan, references: refs.length, policies: refs.reduce((m, r) => (m[r.policy] = (m[r.policy] || 0) + 1, m), {}), edits: edits.length, editedFiles: editedFiles.length, guardObservations: guardObservations.length, unknown: unknown.length }) + '\n');
