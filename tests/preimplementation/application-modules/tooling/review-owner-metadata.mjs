/** Proposed owner metadata shape, deliberately descriptive and non-activating. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const owners = read('owner-boundaries.json');
const schema = {
  required: ['id', 'category', 'root', 'facets', 'subowners', 'contexts', 'publicEntries', 'testReferences', 'devReferences', 'satelliteReferences'],
  properties: {
    id: 'unique kebab-case owner ID', category: 'product | capability | platform', root: 'descriptive source root; never a package manifest',
    facets: 'non-overlapping public/server/web/other package descriptors; names and exports are declaration only',
    subowners: 'unique responsibility IDs with owner/layer/runtime scope', contexts: 'domain context IDs and rank, or explicit empty list',
    publicEntries: 'entry, symbols, layer, runtime, closure/state contract ID; never a wildcard by default',
    testReferences: 'existing test families and future target IDs, not a runner command', devReferences: 'descriptive dev/build references, not scripts to launch',
    satelliteReferences: 'external target IDs/protocol review links, not an activation/deployment manifest'
  },
  forbidden: ['start', 'stop', 'command', 'scripts', 'environment', 'ports', 'credentials', 'activation', 'deployment', 'autostart']
};
const sample = [
  {id: owners.owner.id, category: owners.owner.category, root: owners.owner.root, facets: owners.owner.facets,
    subowners: [{id: 'gratitude-domain', layer: 'domain', runtime: 'server'}, {id: 'gratitude-surface', layer: 'browser', runtime: 'browser'}], contexts: owners.owner.contexts,
    publicEntries: owners.publicEntries.filter(entry => entry.entry.startsWith('@daylight/gratitude/')).map(entry => ({entry: entry.entry, symbols: entry.symbols, layer: entry.layer, contractIds: entry.contractIds || [], closure: entry.contract || entry.prerequisite || 'separate boundary record'})),
    testReferences: ['gratitude-rehearsal.md', 'contracts.json'], devReferences: ['runner-review.json'], satelliteReferences: []},
  {id: owners.sharedCapabilities[0].id, category: owners.sharedCapabilities[0].category, root: owners.sharedCapabilities[0].root, facets: owners.sharedCapabilities[0].facets,
    subowners: [{id: 'presentation-query', layer: 'application', runtime: 'server'}, {id: 'roster-client', layer: 'browser', runtime: 'browser'}], contexts: [], publicEntries: owners.sharedCapabilities[0].publicEntries,
    testReferences: ['household-boundary.json'], devReferences: ['runner-review.json'], satelliteReferences: []}
];
for (const owner of sample) {
  for (const field of schema.required) assert.ok(field in owner, 'Missing schema field ' + field + ' for ' + owner.id);
  assert.equal(owner.root.endsWith('/package.json'), false);
  assert.equal(new Set(owner.facets.map(facet => facet.path)).size, owner.facets.length);
  assert.equal(new Set(owner.subowners.map(subowner => subowner.id)).size, owner.subowners.length);
  assert.ok(!Object.keys(owner).some(key => schema.forbidden.includes(key)), 'Activation field leaked into owner metadata');
}
emit('owner-metadata-review.json', {schema: 'daylight.preimplementation.owner-metadata/v1', proposedSchema: schema, samples: sample,
  references: {externalTargets: 'external-targets.json', runners: 'runner-review.json', testPopulation: 'test-population.json'},
  limits: ['A future owner.json is descriptive metadata only: no package, workspace, target, command, daemon, port, credentials or deployment activation is created by it.', 'Actual owner metadata files, test/dev targets, manifests and build integration remain implementation/package cards.']});
process.stdout.write(JSON.stringify({owners: sample.map(owner => owner.id), forbiddenActivationFields: schema.forbidden.length, output: 'owner-metadata-review.json'}) + '\n');
