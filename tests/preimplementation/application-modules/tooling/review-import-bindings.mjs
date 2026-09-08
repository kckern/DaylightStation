/**
 * Normalize the two pre-migration import maps into a fail-closed binding review.
 * This is a source-design report only: it neither writes candidate imports nor
 * treats a proposed package subpath as installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const imports = read('import-replacements.json');
const boundary = read('boundary-review.json');
const owners = read('owner-boundaries.json');
const entries = read('public-entry-review.json');
const entryNames = new Set(entries.entries.map(entry => entry.entry));
const moves = new Map(owners.moves.map(move => [move.old, move]));
const boundaryByEdge = new Map(boundary.replacements.map(replacement => [replacement.edgeId, replacement]));
const relative = (from, target) => {
  const value = path.posix.relative(path.posix.dirname(from), target);
  return value.startsWith('.') ? value : './' + value;
};
const explicit = new Map([
  ['EDGE-f320be8024c4fb3e', {disposition: 'remove-reexport', bindingOwner: 'installed API composition', target: 'No replacement in the root router barrel; app imports createGratitudeApiRouter from @daylight/gratitude/server/compose.', reason: 'The retained aggregate must not deep-re-export the extracted product router.'}],
  ['EDGE-006bceb5d1939b5c', {disposition: 'move-with-private-factory', bindingOwner: 'gratitude', target: '../application/services/GratitudeService.mjs', reason: 'The import leaves bootstrap with createGratitudeServices and becomes facet-local in modules/gratitude/server/composition/createGratitudeServices.mjs.'}],
  ['EDGE-8496d904a23d2b17', {disposition: 'move-with-private-factory', bindingOwner: 'gratitude', target: '../adapters/yaml/YamlGratitudeDatastore.mjs', reason: 'The import leaves bootstrap with createGratitudeServices and becomes facet-local in modules/gratitude/server/composition/createGratitudeServices.mjs.'}],
  ['EDGE-bf3dec8feb02b85f', {disposition: 'remove-unused-import', bindingOwner: 'installed composition', target: 'none', reason: 'The bootstrap import has no current use; Gratitude API construction remains in its product composition module.'}],
  ['EDGE-8cfd52e6d6893f39', {disposition: 'remove-unused-import', bindingOwner: 'installed composition', target: 'none', reason: 'The bootstrap import has no current use; router construction remains in product composition.'}],
  ['EDGE-02fa26fe83afd185', {disposition: 'public-entry', bindingOwner: 'composition-contract-test', target: '@daylight/gratitude/server/application/print-presentation', reason: 'Retain the existing test as an explicit composition consumer of the reviewed presentation contract.'}],
  ['EDGE-930efdd31aa9844a', {disposition: 'remove-unused-import', bindingOwner: 'gratitude', target: 'none', reason: 'createGratitudeApiRouter already receives gratitudeServices through config; its bootstrap import is unused and would create a reverse composition dependency.'}],
  ['EDGE-c40e01d38e077228', {disposition: 'public-entry', bindingOwner: 'installed composition', target: '@daylight/gratitude/server/compose', symbol: 'createGratitudeApiRouter', reason: 'App retains the same factory name but reaches only the product composition facade.'}],
  ['EDGE-7d9f2de50b21ae02', {disposition: 'public-entry', bindingOwner: 'installed composition', target: '@daylight/gratitude/server/rendering/card-renderer', symbol: 'createGratitudeCardRenderer', reason: 'Only installed composition may construct the renderer; application/API receive its callback.'}],
  ['EDGE-4a934298ca928463', {disposition: 'public-entry', bindingOwner: 'installed composition', target: '@daylight/gratitude/server/application/print-presentation', symbol: 'GratitudePrintPresentationService', reason: 'The current installed composition remains the sole production constructor owner.'}],
  ['EDGE-cff1d13e57acb3f6', {disposition: 'public-entry', bindingOwner: 'installed web composition', target: '@daylight/gratitude/web/icon', reason: 'Preserve the lazy registry icon binding through its public asset entry.'}],
  ['EDGE-56831efe785afda3', {disposition: 'public-entry', bindingOwner: 'installed web composition', target: '@daylight/gratitude/web/surface', reason: 'Preserve the lazy registry component binding through its public surface entry.'}],
  ['EDGE-421b2fba425fda01', {disposition: 'public-entry', bindingOwner: 'installed web composition', target: '@daylight/gratitude/web/settings', reason: 'Preserve the Admin editor mapping through its public settings entry.'}],
  ['EDGE-8917e714424101a0', {disposition: 'public-entry', bindingOwner: 'router-contract-test', target: '@daylight/gratitude/server/compose', symbol: 'createGratitudeApiRouter', reason: 'The migrated contract test must exercise the public composition router factory, not a private router source.'}]
]);
const allowedSameOwnerPairs = new Set([
  'adapters->applications', 'adapters->domains', 'rendering->rendering',
  'domains->domains', 'applications->applications', 'applications->domains',
  'composition->api', 'composition->applications', 'composition->adapters', 'browser->browser-resource'
]);

const gratitude = imports.entries.map(edge => {
  assert.ok(edge.bindingOwner, 'Gratitude edge lacks a binding owner: ' + edge.edge);
  const sourceMove = moves.get(edge.from);
  const targetMove = moves.get(edge.oldTarget);
  const foundation = boundaryByEdge.get(edge.edge);
  let selectedSpecifier = edge.selectedSpecifier || null;
  let resolution = edge.selectedSpecifier ? 'selected' : 'unresolved';
  let reason = edge.status;
  if (!selectedSpecifier && sourceMove && targetMove) {
    selectedSpecifier = relative(edge.newFrom, edge.newTarget);
    resolution = 'same-owner-relative';
    reason = 'Both source and target have the Gratitude owner; preserve a facet-local relative import.';
  } else if (!selectedSpecifier && foundation?.targets?.length && foundation.targets.every(target => target.proposedEntry && !target.unresolved)) {
    const proposedEntries = [...new Set(foundation.targets.map(target => target.proposedEntry))];
    if (proposedEntries.length === 1) {
      selectedSpecifier = proposedEntries[0];
      resolution = 'foundation-public-entry';
      reason = 'All imported symbols have one reviewed foundation public entry.';
    } else {
      resolution = 'split-required';
      reason = 'Imported symbols resolve to multiple reviewed entries; split the declaration before applying the move.';
    }
  }
  const explicitPlan = explicit.get(edge.edge);
  if (explicitPlan) {
    selectedSpecifier = explicitPlan.disposition === 'public-entry' ? explicitPlan.target : null;
    resolution = explicitPlan.disposition;
    reason = explicitPlan.reason;
  }
  const layerCheck = sourceMove && targetMove ? {
    sourceLayer: sourceMove.layer, targetLayer: targetMove.layer,
    sourceOwner: sourceMove.owner, targetOwner: targetMove.owner,
    result: sourceMove.owner === targetMove.owner ? 'same-owner visibility still requires the existing layer rules' : 'not a same-owner import'
  } : null;
  if (layerCheck && sourceMove.layer !== 'test') {
    assert.equal(sourceMove.owner, targetMove.owner, 'Relative facet import crosses owners: ' + edge.edge);
    assert.ok(allowedSameOwnerPairs.has(sourceMove.layer + '->' + targetMove.layer), 'Relative facet import violates selected layer direction: ' + edge.edge + ' ' + sourceMove.layer + '->' + targetMove.layer);
    layerCheck.result = 'allowed by preserved D1–D10 layer direction';
  } else if (layerCheck) {
    layerCheck.result = 'test-owned import; production visibility is not expanded';
  }
  return {
    edgeId: edge.edge, consumer: edge.from, proposedConsumer: edge.newFrom,
    line: edge.line, oldSpecifier: edge.oldSpecifier, oldTarget: edge.oldTarget,
    proposedTarget: edge.newTarget, symbols: edge.symbols, relationship: edge.relationship,
    bindingOwner: explicitPlan?.bindingOwner || edge.bindingOwner, resolution, selectedSpecifier, exactDisposition: explicitPlan || null, reason,
    decision: edge.decision || edge.blockingDecision || null,
    contractIds: edge.contractIds || [],
    layerCheck
  };
});

const foundation = boundary.replacements.flatMap(replacement => replacement.targets.map(target => ({
  edgeId: replacement.edgeId, consumer: replacement.consumer, line: replacement.line,
  oldSpecifier: replacement.oldSpecifier, oldTarget: replacement.oldTarget,
  symbol: target.symbol, local: target.local, proposedTarget: target.proposedSource,
  proposedEntry: target.proposedEntry, semanticLayer: target.semanticLayer,
  resolution: target.unresolved ? 'retained-or-decision-required' : target.proposedEntry ? 'foundation-public-entry' : 'unresolved',
  bindingOwner: 'consumer owner', decision: target.unresolved || null,
  reviewGate: replacement.reviewGate
})));

const unresolvedGratitude = gratitude.filter(edge => edge.resolution === 'unresolved' || edge.resolution === 'split-required');
const invalidFoundationEntries = foundation.filter(edge => edge.proposedEntry && !entryNames.has(edge.proposedEntry));
const invalidExactFoundation = foundation.filter(edge => edge.resolution === 'foundation-public-entry' && !edge.proposedEntry);
assert.equal(invalidExactFoundation.length, 0, 'A foundation public resolution lacks its entry');
assert.ok(gratitude.every(edge => edge.bindingOwner && edge.proposedTarget && edge.relationship), 'Incomplete Gratitude binding row');
assert.ok(foundation.every(edge => edge.bindingOwner && edge.reviewGate), 'Incomplete foundation binding row');

const summary = {
  gratitudeEdges: gratitude.length,
  gratitudeExact: gratitude.length - unresolvedGratitude.length,
  gratitudeUnresolved: unresolvedGratitude.length,
  gratitudeByResolution: Object.groupBy(gratitude, edge => edge.resolution),
  foundationSymbolBindings: foundation.length,
  foundationExact: foundation.filter(edge => edge.resolution === 'foundation-public-entry').length,
  foundationRetainedOrDecisionRequired: foundation.filter(edge => edge.resolution === 'retained-or-decision-required').length,
  foundationEntriesAbsentFromPublicMatrix: invalidFoundationEntries.length
};
for (const [key, values] of Object.entries(summary.gratitudeByResolution)) summary.gratitudeByResolution[key] = values.length;
emit('import-binding-review.json', {
  schema: 'daylight.preimplementation.import-binding-review/v1',
  status: unresolvedGratitude.length || invalidFoundationEntries.length ? 'incomplete; explicit unresolved bindings remain' : 'all selected import bindings have exact targets',
  rules: [
    'Cross-owner source imports use a reviewed public entry or remain explicitly blocked; no deep private facet import is substituted.',
    'Same-owner moves use a facet-local relative path only after the source and target have the same proposed owner; the existing D1–D10 layer rules still apply.',
    'An unresolved symbol is retained at its current spelling or blocked by its named decision; it is not silently assigned a guessed package subpath.'
  ],
  summary, gratitude, foundation,
  blockers: unresolvedGratitude.map(edge => ({edgeId: edge.edgeId, consumer: edge.consumer, line: edge.line, oldSpecifier: edge.oldSpecifier, target: edge.oldTarget, relationship: edge.relationship, bindingOwner: edge.bindingOwner, requiredDecision: edge.decision || 'select a reviewed public entry or explicit retained binding'})).concat(invalidFoundationEntries.map(edge => ({edgeId: edge.edgeId, consumer: edge.consumer, line: edge.line, target: edge.oldTarget, proposedEntry: edge.proposedEntry, requiredDecision: 'add the entry to the public-entry matrix before rewrite approval'}))),
  limits: ['This review covers static source-import bindings represented by the Gratitude and foundation ledgers only.', 'Resources, styles, URL/build references, dynamic registrations, manifests and candidate resolution remain governed by their separate preparation gates.']
});
process.stdout.write(JSON.stringify({
  gratitudeEdges: summary.gratitudeEdges,
  gratitudeExact: summary.gratitudeExact,
  gratitudeUnresolved: summary.gratitudeUnresolved,
  foundationSymbolBindings: summary.foundationSymbolBindings,
  foundationExact: summary.foundationExact,
  foundationEntryGaps: summary.foundationEntriesAbsentFromPublicMatrix,
  output: 'import-binding-review.json'
}) + '\n');
