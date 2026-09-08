/** Public-entry matrix: symbols, consumers, closure and identity rules are all explicit. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, root, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const boundary = read('boundary-review.json');
const owners = read('owner-boundaries.json');
const ledger = read('dependency-ledger.json');
const reviewed = new Map(boundary.files.map(file => [file.proposedPath, file]));
const publicEntries = boundary.entries.map(entry => {
  const file = reviewed.get(entry.source);
  assert.ok(file, 'Public entry has no reviewed source: ' + entry.entry);
  assert.notEqual(file.owner, 'mixed', 'Mixed body must not be a public entry: ' + entry.entry);
  const names = new Map(file.exports.map(item => [item.name, item]));
  for (const symbol of entry.symbols) {
    const detail = names.get(symbol);
    assert.ok(detail, 'Entry symbol has no actual declaration: ' + entry.entry + ':' + symbol);
    assert.equal(detail.proposedEntry, entry.entry, 'Symbol maps to a different entry: ' + entry.entry + ':' + symbol);
  }
  const closure = ledger.edges.filter(edge => edge.from === file.path).map(edge => ({edgeId: edge.id, line: edge.line, specifier: edge.specifier, kind: edge.kind, target: edge.target}));
  return {entry: entry.entry, owner: entry.owner, layer: entry.layer || file.contractKind, runtime: file.runtime, context: entry.context, rank: entry.rank,
    source: file.path, proposedSource: entry.source, symbols: entry.symbols.map(symbol => ({name: symbol, consumers: names.get(symbol).consumers})),
    closure, stateExpectation: file.stateConstraint, contractIds: file.contractIds, mixedBarrel: false};
});
const gratitudeContracts = {
  '@daylight/gratitude/server/adapters/image-print-gateway': ['CTR-GR-PRINT-03'],
  '@daylight/gratitude/server/compose': ['CTR-GR-COMPOSE-01'],
  '@daylight/gratitude/web/surface': ['CTR-GR-UI-01', 'CTR-GR-UI-02'],
  '@daylight/gratitude/web/settings': ['CTR-GR-CONSUMER-04'],
  '@daylight/gratitude/web/icon': ['CTR-GR-ARTIFACT-01']
};
const gratitudeSymbolSources = {
  '@daylight/gratitude/server/adapters/image-print-gateway': {default: 'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs', TemporaryImagePrintGateway: 'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs'},
  '@daylight/gratitude/server/compose': {createGratitudeServices: 'backend/src/5_composition/bootstrap.mjs', createGratitudeApiRouter: 'backend/src/5_composition/modules/gratitudeApi.mjs'},
  '@daylight/gratitude/web/surface': {'default (Gratitude)': 'frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx'},
  '@daylight/gratitude/web/settings': {'default (GratitudeConfig)': 'frontend/src/modules/Admin/Apps/GratitudeConfig.jsx'},
  '@daylight/gratitude/web/icon': {'default URL': 'frontend/src/assets/app-icons/gratitude.svg'}
};
// These are intentionally narrow server entries.  They are for retained
// installed composition and its contract tests, not permission for another
// application/domain to reach through Gratitude's private implementation.
const gratitudeSupplementalEntries = [
  {entry: '@daylight/gratitude/server/events', layer: 'application', runtime: 'server', source: 'backend/src/3_applications/events/RealtimePublications.mjs', proposedSource: 'modules/gratitude/server/application/events/GratitudeEvents.mjs', symbols: ['GratitudeEvents'], contractIds: ['CTR-GR-EVENT-01'], consumers: ['backend/src/5_composition/modules/gratitudeApi.mjs', 'tests/isolated/api/infrastructure-seams-contract.test.mjs'], allowedConsumers: 'Gratitude composition and its explicit contract test only; unrelated mixed publication classes remain private in their current source.'},
  {entry: '@daylight/gratitude/server/rendering/card-renderer', layer: 'rendering', runtime: 'server', source: 'backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs', proposedSource: 'modules/gratitude/server/rendering/GratitudeCardRenderer.mjs', symbols: ['createGratitudeCardRenderer'], contractIds: ['CTR-GR-PRINT-02', 'CTR-GR-ARTIFACT-01'], consumers: ['backend/src/app.mjs'], allowedConsumers: 'Installed composition only; application/API/domain code receives the resulting callback, never the renderer.'},
  {entry: '@daylight/gratitude/server/application/print-presentation', layer: 'application', runtime: 'server', source: 'backend/src/3_applications/gratitude/services/GratitudePrintPresentationService.mjs', proposedSource: 'modules/gratitude/server/application/services/GratitudePrintPresentationService.mjs', symbols: ['GratitudePrintPresentationService'], contractIds: ['CTR-GR-PRINT-01'], consumers: ['backend/src/app.mjs', 'backend/src/5_composition/composition-contract-registry.test.mjs'], allowedConsumers: 'Installed composition and its explicit contract test only; it is not a renderer or storage public API.'}
];
const gratitudeEntries = owners.publicEntries.map(entry => {
  const symbolSources = gratitudeSymbolSources[entry.entry];
  assert.ok(symbolSources, 'Missing Gratitude symbol-source map: ' + entry.entry);
  for (const [symbol, source] of Object.entries(symbolSources)) {
    assert.ok(entry.symbols.includes(symbol), 'Unexpected source symbol: ' + entry.entry + ':' + symbol);
    assert.ok(fs.existsSync(path.join(root, source)), 'No existing source basis: ' + entry.entry + ':' + symbol);
  }
  const runtime = entry.layer.startsWith('browser') ? 'browser' : 'server';
  const sources = [...new Set(Object.values(symbolSources))];
  const closure = ledger.edges.filter(edge => sources.includes(edge.from)).map(edge => ({edgeId: edge.id, line: edge.line, specifier: edge.specifier, kind: edge.kind, target: edge.target}));
  const contractIds = entry.contractIds || gratitudeContracts[entry.entry];
  assert.ok(contractIds?.length, 'Public Gratitude entry lacks a contract: ' + entry.entry);
  return {entry: entry.entry, owner: 'gratitude', layer: entry.layer, runtime, source: sources, proposedSource: entry.implementationDestination || entry.facade || 'future public facade',
    symbols: entry.symbols.map(name => ({name, source: symbolSources[name], consumers: entry.consumers})), closure, stateExpectation: entry.contract || entry.prerequisite || 'preserve current binding/behavior documented by linked contract', contractIds, mixedBarrel: false};
});
const supplementalEntries = gratitudeSupplementalEntries.map(entry => {
  assert.ok(fs.existsSync(path.join(root, entry.source)), 'No existing source basis: ' + entry.entry);
  const actualNames = new Set(ledger.exports.filter(item => item.from === entry.source).map(item => item.name));
  for (const symbol of entry.symbols) assert.ok(actualNames.has(symbol), 'Supplemental entry symbol has no existing declaration: ' + entry.entry + ':' + symbol);
  const closure = ledger.edges.filter(edge => edge.from === entry.source).map(edge => ({edgeId: edge.id, line: edge.line, specifier: edge.specifier, kind: edge.kind, target: edge.target}));
  return {...entry, owner: 'gratitude', stateExpectation: 'Preserve the current constructor/function identity and contract; entry is composition-scoped.', closure, mixedBarrel: false};
});
const entries = [...publicEntries, ...gratitudeEntries, ...supplementalEntries];
assert.equal(entries.length, 57);
assert.equal(new Set(entries.map(entry => entry.entry)).size, entries.length);
assert.ok(entries.every(entry => entry.symbols.length && entry.contractIds.length && entry.runtime && entry.layer));
emit('public-entry-review.json', {schema: 'daylight.preimplementation.public-entry-review/v1', entries,
  summary: {platformEntries: publicEntries.length, gratitudeEntries: gratitudeEntries.length + supplementalEntries.length, total: entries.length},
  rules: ['Every entry is backed by an existing source declaration and its direct static closure.', 'No mixed source barrel is public; the sole mixed RealtimePublications body remains a per-symbol split, not an entry.', 'A facade forwards the reviewed canonical binding; it does not create a new singleton, React context, logger, native module or product behavior.'],
  limits: ['This source matrix is not a generated package manifest or candidate runtime proof.', 'Zero current consumers for a listed symbol are retained as observed source facts; any new public entry still needs explicit consumer/contract approval.']});
process.stdout.write(JSON.stringify({entries: entries.length, platform: publicEntries.length, gratitude: gratitudeEntries.length + supplementalEntries.length, output: 'public-entry-review.json'}) + '\n');
