/** Classify every external dependency reached by the selected public/move closure. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const ledger = read('dependency-ledger.json');
const entries = read('public-entry-review.json').entries;
const owners = read('owner-boundaries.json');
const sources = new Set(entries.flatMap(entry => Array.isArray(entry.source) ? entry.source : [entry.source]).filter(Boolean));
for (const move of owners.moves) sources.add(move.old);
const packageEdges = ledger.edges.filter(edge => sources.has(edge.from) && edge.kind === 'package');
const records = new Map();
for (const edge of packageEdges) {
  const record = records.get(edge.package.name) || {name: edge.package.name, versions: new Set(), instances: new Set(), importers: []};
  record.versions.add(edge.package.version); record.instances.add(edge.package.instance);
  record.importers.push({edgeId: edge.id, from: edge.from, line: edge.line, specifier: edge.specifier}); records.set(record.name, record);
}
const policy = {
  'uuid': {sharing: 'must-share within the server facet', treatment: 'server dependency pinned to observed 11.1.0', test: 'future candidate resolver identity probe', representability: 'No current unresolved question; do not inherit root uuid 14.x.'},
  'js-yaml': {sharing: 'must-share within platform server FileIO graph; test copies remain isolated', treatment: 'platform-server dependency pinned to observed 4.1.0', test: 'FileIO native identity fixture', representability: 'Root test import is not runtime package authority.'},
  'axios': {sharing: 'one platform-server HTTP/FileIO dependency scope', treatment: 'platform-server dependency pinned to observed 1.10.0', test: 'FileIO/HTTP native fixture', representability: 'No candidate manifest proof yet.'},
  'moment-timezone': {sharing: 'must-separate server 0.6.0 from web 0.5.47 and root 0.5.46', treatment: 'server facet direct dependency pinned to observed 0.6.0; never hoist', test: 'CASE-PKG-ACTUAL-TIMEZONES; CASE-PKG-ROOT-TIMEZONE; nested-install red/restored probe', representability: 'Workspace placement must preserve the three scopes in both import orders.'},
  'canvas': {sharing: 'must-share backend native 3.1.0 among selected server renderers; must-separate root 3.2.1', treatment: 'platform-server native dependency resolved from backend scope only', test: 'CASE-PKG-NATIVE; rendering identity root-fallback red control', representability: 'BLOCKED: backend manifest range is ^3.2.1 while inspected install is 3.1.0; lock/ABI/Linux adoption must be decided before manifest edit.'},
  'vitest': {sharing: 'test-only scopes remain separate: backend 4.0.18 and root 4.1.10', treatment: 'dev dependency of the owning runner/test facet; never a runtime or public-facade dependency', test: 'existing original suite population and runner-review selections', representability: 'Test relocation must select one runner scope per moved test; no generic hoist is approved.'},
  'express': {sharing: 'one installed server router identity per candidate composition', treatment: 'server facet direct dependency pinned to observed 5.2.1', test: 'Gratitude HTTP contract cases plus public compose resolver probe', representability: 'Candidate package must prove router factory does not import baseline controller.'},
  'rss-parser': {sharing: 'not a Gratitude dependency', treatment: 'remove with extraction of the exclusive Gratitude factory from global bootstrap', test: 'IMP-SHARED.01 closure/no-controller-import negative', representability: 'No new facet dependency; the current edge is from unrelated bootstrap closure.'},
  'react': {sharing: 'must-share one 18.3.1 React with provider, consumers and ReactDOM', treatment: 'peer dependency of all web facets; host supplies exact observed instance', test: 'CASE-PKG-REACT plus WebSocket/Admin context duplicate-instance reds', representability: 'Peer range/install topology must reject a nested React copy.'},
  '@mantine/notifications': {sharing: 'must-share host web UI scope with Mantine core', treatment: 'web peer dependency pinned to observed 7.11.1', test: 'Admin affected-surface candidate test', representability: 'Peer declaration and Vite dedupe need candidate build proof.'},
  '@mantine/core': {sharing: 'must-share host web UI scope; context/provider identity matters', treatment: 'web peer dependency pinned to observed 7.11.1', test: 'Admin affected-surface candidate test and context identity red', representability: 'Peer declaration and Vite dedupe need candidate build proof.'},
  '@tabler/icons-react': {sharing: 'host web UI scope; no server import', treatment: 'web dependency pinned to observed 3.10.0', test: 'Admin affected-surface candidate test', representability: 'Browser build closure remains open.'},
  '@mantine/hooks': {sharing: 'must-share host web UI scope with Mantine', treatment: 'web peer dependency pinned to observed 7.11.1', test: 'Admin affected-surface candidate test', representability: 'Peer declaration and Vite dedupe need candidate build proof.'},
  'date-fns': {sharing: 'pure value library; duplication not an identity contract', treatment: 'Gratitude web direct dependency pinned to observed 2.30.0', test: 'Gratitude web surface candidate test', representability: 'Current source resolves root instance; web facet must declare it explicitly and prove Vite resolution.'}
};
assert.deepEqual([...records.keys()].sort(), Object.keys(policy).sort(), 'Dependency policy must classify every selected package edge');
const dependencies = [...records.values()].map(record => ({
  name: record.name, versions: [...record.versions].sort(), instances: [...record.instances].sort(), importers: record.importers, ...policy[record.name]
})).sort((a, b) => a.name.localeCompare(b.name));
const topology = read('package-topology-review.json');
const workspaceEdges = topology.packages.filter(item => item.facet === 'public').map(item => ({
  package: item.name, dependencies: topology.packages.filter(candidate => candidate.owner === item.owner && candidate.facet !== 'public').map(candidate => ({name: candidate.name, version: 'workspace:*', rule: 'public facade may depend only on its matching owner private facet'}))
}));
assert.ok(dependencies.every(item => item.versions.length && item.sharing && item.treatment && item.test && item.representability));
emit('dependency-identity-review.json', {
  schema: 'daylight.preimplementation.dependency-identity-review/v1',
  status: 'all selected external dependencies classified; candidate manifest/install proof remains separately gated',
  dependencies, workspaceEdges,
  acceptance: ['CASE-PKG-SIBLINGS', 'CASE-PKG-PRIVATE', 'CASE-PKG-ACTUAL-TIMEZONES', 'CASE-PKG-ROOT-TIMEZONE', 'CASE-PKG-REACT', 'CASE-PKG-NATIVE', 'run-package-install red/restored controls', 'rendering identity red/restored controls'],
  limits: ['This is static installed-scope characterization and a future manifest rule set, not a lockfile edit or proof of production install/build/Linux ABI.', 'A named representability question is a gate, not permission to choose a convenient version, hoist or nested duplicate.']
});
process.stdout.write(JSON.stringify({dependencies: dependencies.length, workspacePackages: workspaceEdges.length, blocked: dependencies.filter(item => item.representability.startsWith('BLOCKED')).map(item => item.name), output: 'dependency-identity-review.json'}) + '\n');
