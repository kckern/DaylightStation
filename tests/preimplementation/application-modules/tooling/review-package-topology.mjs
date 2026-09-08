/** Prospective facet topology; no package manifest is created or changed. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const owners = read('owner-boundaries.json');
const publicEntries = read('public-entry-review.json').entries;
const householdBoundary = read('household-boundary.json');
const householdEntries = owners.sharedCapabilities[0].publicEntries.map(entry => ({...entry, owner: 'household-identity'}));
const entries = [...publicEntries, ...householdEntries];
const roots = [
  {id: 'platform', root: 'platform', category: 'platform', facets: [
    ['public', '@daylight/platform'], ['server', '@daylight-internal/platform--server'], ['web', '@daylight-internal/platform--web']
  ]},
  {id: owners.owner.id, root: owners.owner.root, category: owners.owner.category, facets: owners.owner.facets.map(f => [path.posix.basename(f.path), f.name])},
  ...owners.sharedCapabilities.map(owner => ({id: owner.id, root: owner.root, category: owner.category, facets: owner.facets.map(f => [path.posix.basename(f.path), f.name])})),
  {id: 'admin', root: 'modules/admin', category: 'product', facets: [['public', '@daylight/admin'], ['web', '@daylight-internal/admin--web']]},
  {id: 'contracts', root: 'shared/contracts', category: 'declarative-contract', rootIsPackage: true, facets: [['public', '@daylight/contracts']]}
];
const packageForEntry = entry => {
  const match = [...roots].find(root => entry.entry.startsWith('@daylight/' + root.id + '/') || entry.entry.startsWith('@daylight/platform/'));
  assert.ok(match, 'No owner package root for entry: ' + entry.entry);
  const prefix = match.id === 'platform' ? '@daylight/platform/' : '@daylight/' + match.id + '/';
  const subpath = './' + entry.entry.slice(prefix.length);
  const facet = subpath.startsWith('./web/') ? 'web' : subpath.startsWith('./server/') ? 'server' : 'public';
  return {root: match, subpath, facet};
};
const packages = roots.flatMap(root => root.facets.map(([facet, name]) => ({
  owner: root.id, category: root.category, root: root.root, facet, path: path.posix.join(root.root, facet), name,
  private: true, type: 'module', exports: {}
})));
const byOwnerFacet = new Map(packages.map(item => [item.owner + ':' + item.facet, item]));
for (const root of roots) {
  const own = packages.filter(item => item.owner === root.id);
  assert.ok(own.some(item => item.facet === 'public'), 'Every selected owner has a public facet: ' + root.id);
  if (!root.rootIsPackage) assert.ok(!own.some(item => item.path === root.root), 'Owner root cannot be a workspace package: ' + root.id);
  for (const a of own) for (const b of own) if (a !== b) assert.ok(!b.path.startsWith(a.path + '/'), 'Facet workspaces must be siblings, not nested: ' + a.path + ' / ' + b.path);
}
for (const entry of entries) {
  const {root, subpath, facet} = packageForEntry(entry);
  const pub = byOwnerFacet.get(root.id + ':public');
  const internal = byOwnerFacet.get(root.id + ':' + facet);
  assert.ok(pub && internal, 'Entry lacks required public/private facet: ' + entry.entry);
  assert.ok(!pub.exports[subpath], 'Public subpath collision: ' + pub.name + ' ' + subpath);
  assert.ok(!internal.exports[subpath], 'Private subpath collision: ' + internal.name + ' ' + subpath);
  const extension = entry.runtime === 'browser' && /icon$/.test(subpath) ? '.svg' : '.mjs';
  pub.exports[subpath] = './' + subpath.slice(2) + extension;
  internal.exports[subpath] = './' + subpath.slice(2) + extension;
}
assert.equal(new Set(packages.map(item => item.name)).size, packages.length, 'Package-name collision');
for (const item of packages) assert.ok(Object.keys(item.exports).every(key => key.startsWith('./') && !key.includes('..')), 'Unsafe export map: ' + item.name);
const householdPublic = householdBoundary.manifests.find(manifest => manifest.content.name === '@daylight/household-identity');
assert.ok(householdPublic, 'Household identity public manifest specification missing');
assert.deepEqual(Object.keys(byOwnerFacet.get('household-identity:public').exports).sort(), Object.keys(householdPublic.content.exports).sort(), 'Household public exports drift from its selected manifest specification');

emit('package-topology-review.json', {
  schema: 'daylight.preimplementation.package-topology-review/v1',
  status: 'prospective sibling workspace topology selected; manifests remain uncreated',
  roots, packages: packages.map(item => ({...item, exports: Object.fromEntries(Object.entries(item.exports).sort())})),
  entryCount: entries.length,
  rules: [
    'An owner root is never a package; its public/server/web sibling facets are the only selected workspaces.',
    'Public packages forward only declared subpaths to the matching private facet; no wildcard export or cross-owner private import is allowed.',
    'Internal facets are private workspaces and may be depended on only by their owner public facade or explicitly reviewed same-owner tooling.'
  ],
  acceptance: ['CASE-PKG-NONOVERLAP', 'CASE-PKG-SIBLINGS', 'CASE-PKG-PRIVATE-REJECT', 'CASE-PKG-EXPORT-REJECT'],
  limits: ['This describes manifest topology and export-map keys only. It does not create workspaces, package manifests, aliases, lockfile entries or candidate package resolution.']
});
process.stdout.write(JSON.stringify({roots: roots.length, packages: packages.length, entryCount: entries.length, output: 'package-topology-review.json'}) + '\n');
