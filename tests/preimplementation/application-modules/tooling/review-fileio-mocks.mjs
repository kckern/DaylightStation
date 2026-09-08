/** Static exposure accounting for the observed public/private mock distinction. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root, packet, emit } from './census.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const inputNames = ['source-ledger.json', 'dependency-ledger.json', 'utility-reference-review.json', 'utility-boundary.json', 'owner-boundaries.json'];
const [ledger, graph, references, utility, owners] = inputNames.map(read);
const ioPath = 'backend/src/0_system/utils/FileIO.mjs';
const publicTarget = '@daylight/platform/server/system/utils/file-io';
const retiring = new Set(['backend/src/0_system/utils/index.mjs', 'backend/src/0_system/utils/errors/index.mjs']);
const foundation = new Set(owners.foundation.map(f => f.path));
const mocks = references.constructions.filter(c => c.followup?.gate === 'FILEIO-MOCK-IDENTITY');
assert.equal(mocks.length, 22);
const changes = new Map(utility.edgeDispositions.map(e => [e.edgeId, e]));
const sourceEdges = graph.edges.filter(e => e.kind === 'source');
const projectedEdges = sourceEdges.flatMap(edge => {
  if (retiring.has(edge.from)) return [];
  const change = changes.get(edge.id);
  if (!change) return [edge];
  if (change.action.startsWith('removed with')) return [];
  if (change.bindings) return [...new Set(change.bindings.map(b => b.origin.file))].map(target => ({ ...edge, target }));
  if (change.newTarget) return [{ ...edge, target: change.newTarget }];
  assert.equal(change.action, 'rewrite lazy literal');
  return [edge]; // Core error barrel retains its implementation origin.
});
const adjacency = edges => {
  const out = new Map();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from).push(edge);
  }
  return out;
};
const oldGraph = adjacency(sourceEdges), nextGraph = adjacency(projectedEdges);
const incompleteEdges = adjacency(graph.edges.filter(e => e.kind.startsWith('unresolved')));
function closure(entry, edges) {
  const visited = new Set([entry]), queue = [entry], ioEdges = [], unresolved = [];
  const witnesses = new Map([[entry, []]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const from = queue[cursor];
    unresolved.push(...(incompleteEdges.get(from) || []).map(e => ({ edgeId: e.id, from: e.from, line: e.line, specifier: e.specifier })));
    for (const edge of edges.get(from) || []) {
      const witness = [...witnesses.get(from), edge.id];
      if (edge.target === ioPath) {
        ioEdges.push({ edgeId: edge.id, from: edge.from, line: edge.line, directFromTest: from === entry, foundation: foundation.has(from), witness });
        continue;
      }
      if (visited.has(edge.target)) continue;
      visited.add(edge.target); queue.push(edge.target); witnesses.set(edge.target, witness);
    }
  }
  return { reachedSourceFiles: visited.size, ioEdges, unresolved };
}
const rows = mocks.map(mock => {
  const source = fs.readFileSync(path.join(root, mock.path), 'utf8');
  const sourceSha256 = sha(source);
  assert.equal(sourceSha256, ledger.files.find(f => f.path === mock.path).sha256);
  const before = source.slice(mock.start, mock.end);
  assert.ok(before.includes('#system/utils/FileIO.mjs'));
  const old = closure(mock.path, oldGraph), proposed = closure(mock.path, nextGraph);
  const helperAnchors = {
    'tests/isolated/application/fitness/ActivityReconciliationService.test.mjs': 'const historyRepository = (remove = vi.fn(() => true)) => ({',
    'tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs': 'const historyRepository = () => ({',
    'tests/isolated/application/fitness/sliverAbsorption.test.mjs': 'const absorbOverlappingSlivers = (activity, sessionDir, options = {}) => {',
  };
  const helper = helperAnchors[mock.path];
  if (helper) assert.ok(source.includes(helper));
  return {
    path: mock.path, line: mock.line, start: mock.start, end: mock.end,
    sourceSha256, mockCallSha256: sha(before), currentTarget: '#system/utils/FileIO.mjs', candidatePublicTarget: publicTarget,
    baseline: old, utilityProjected: proposed,
    ...(helper ? { testOwnedConsumer: { anchor: helper, line: source.slice(0, source.indexOf(helper)).split('\n').length, meaning: 'Test-local mock functions assemble/pass in-memory history data through injected semantic dependencies. No production application/FileIO import is inferred, and the mock is not dead merely because no production reader is reachable.' } } : {}),
    disposition: 'No blanket private-target rewrite. Match factory and subject import URLs after exact foundation edits; public target remains a candidate where all affected readers enter through it. Existing suites and mock scopes must be inspected/run safely before approval.',
    gates: ['FILEIO-MOCK-IDENTITY', 'FILEIO-DYNAMIC-IDENTITY', 'IMP-SHARED.04'],
  };
});
const originalFoundationIO = sourceEdges.filter(e => e.target === ioPath && foundation.has(e.from));
const projectedFoundationIO = projectedEdges.filter(e => e.target === ioPath && foundation.has(e.from));
assert.deepEqual(originalFoundationIO.map(e => e.from), ['backend/src/0_system/utils/index.mjs']);
assert.equal(projectedFoundationIO.length, 0);
const report = {
  schema: 'daylight.preimplementation.fileio-mock-review/v1', baseline: ledger.baseline,
  status: 'Source exposure reviewed; real suite/candidate/native mock adoption remains pending',
  mocks: rows,
  foundation: {
    candidates: foundation.size,
    originalDirectIOEdges: originalFoundationIO.map(e => ({ edgeId: e.id, from: e.from, syntax: e.syntax })),
    utilityProjectedDirectIOEdges: projectedFoundationIO,
    conclusion: 'The synthetic private-reader counterexample is not a demonstrated regression in the current first-move design: among the 50 foundation files only the retiring utility barrel imports FileIO. Do not introduce a universal test shim or private-import exemption from this experiment. Reopen if the foundation/private reader set changes.',
  },
  summary: {
    mockSites: rows.length,
    uniqueFiles: new Set(rows.map(r => r.path)).size,
    baselineReachedIOConsumers: new Set(rows.flatMap(r => r.baseline.ioEdges.filter(e => !e.directFromTest).map(e => e.from))).size,
    utilityProjectedReachedIOConsumers: new Set(rows.flatMap(r => r.utilityProjected.ioEdges.filter(e => !e.directFromTest).map(e => e.from))).size,
    rowsWithUnresolvedSourceEdges: rows.filter(r => r.utilityProjected.unresolved.length).length,
    projectedFoundationPrivateReaders: projectedFoundationIO.length,
    testOwnedMockConsumers: rows.filter(r => r.testOwnedConsumer).length,
  },
  inputs: mocks.map(m => ({ path: m.path, sha256: sha(fs.readFileSync(path.join(root, m.path))) })),
  inventoryInputs: inputNames.map(name => ({ name, sha256: sha(fs.readFileSync(path.join(packet, name))) })),
  toolHash: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
  limits: [
    'Static import graph overapproximation, not executed mock-scope closure: other mocks, branches, external packages and computed imports can change actual loads',
    'Utility projection uses selected source dispositions and retirements; not a full relocated/installed candidate',
    'Source witness edge IDs refer to original canonical source; projected edges may use their selected utility origin',
    'No original test body, provider, data root, application or proposed product implementation is evaluated',
    'A public test target is still unapproved until exact consumer imports, factories/hoisting/partial namespaces and isolated original cases are verified',
  ],
};
emit('fileio-mock-review.json', report);
process.stdout.write(JSON.stringify(report.summary) + '\n');
