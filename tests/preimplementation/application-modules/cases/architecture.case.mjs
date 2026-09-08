// Explicit preparation runner only; intentionally outside default test globs.
/** Current-checker observations are distinct from prototype enforcement. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAstViolations, scanDomainHierarchyViolations } from '../../../../scripts/audit-layer-imports.mjs';
import {scanDirectFsImports} from '../../../../scripts/audit-direct-fs-imports.mjs';
const old = '/fixture/backend/src/3_applications/gratitude/probe.mjs';
const moved = '/fixture/modules/gratitude/server/application/probe.mjs';
test('CASE-ARCH-CURRENT-OLD current checker rejects old-path application filesystem imports', () => {
  assert.ok(scanAstViolations(old, "import fs from 'node:fs';").some(v => v.rule === 'apps-no-fs'));
  assert.deepEqual(scanAstViolations(old, 'export const pure = x => x;'), []);
});
test('CASE-ARCH-CURRENT-NEW observed current-checker gap: new owner path is missed', () => {
  assert.deepEqual(scanAstViolations(moved, "import fs from 'node:fs';"), []);
  process.stderr.write('CURRENT_GATE_GAP new-owner-path filesystem import is undetected\n');
});
test('CASE-ARCH-CURRENT-PUBLIC observed current-checker gap: public facade layer is unresolved', () => {
  assert.deepEqual(scanAstViolations('/fixture/backend/src/4_api/probe.mjs', "import {run} from '@daylight/gratitude/server/commands';"), []);
  process.stderr.write('CURRENT_GATE_GAP public facade can hide application target from API check\n');
});
test('CASE-ARCH-CURRENT-RANK observed unknown-domain rank is silently accepted', () => {
  assert.deepEqual(scanDomainHierarchyViolations('/fixture/backend/src/2_domains/books/probe.mjs', "import x from '#domains/health/x.mjs';"), []);
  process.stderr.write('CURRENT_GATE_GAP unknown books rank is undetected\n');
});
test('CASE-ARCH-CURRENT-D10-OLD separate filesystem gate rejects current outer-layer import forms', () => {
  for (const source of ["import fs from 'node:fs';", "export * from 'node:fs/promises';",
    "const fs = require('fs');", "const fs = await import('node:fs');"])
    assert.equal(scanDirectFsImports('backend/src/4_api/probe.mjs', source).length, 1);
  assert.deepEqual(scanDirectFsImports('backend/src/4_api/probe.mjs', 'export const pure = x => x;'), []);
  assert.deepEqual(scanDirectFsImports('backend/src/0_system/probe.mjs', "import fs from 'node:fs';"), []);
});
for (const file of ['modules/gratitude/server/api/probe.mjs', 'capabilities/print-output/server/adapters/probe.mjs',
  'platform/server/rendering/probe.mjs'])
  test('CASE-ARCH-CURRENT-D10-NEW-' + file.split('/')[0] + ' separate filesystem gate misses prospective runtime root', () => {
    assert.deepEqual(scanDirectFsImports(file, "import fs from 'node:fs';"), []);
    process.stderr.write('CURRENT_GATE_GAP D10 scope misses ' + file + '\n');
  });

// Finite metadata prototype: semantic source/target identities supplied explicitly.
// It is not a complete production resolver, D1-D10 implementation or adopted gate.
function violations(from, to, edge = {}) {
  if (!from || !to) return ['unclassified-source-or-target'];
  if (edge.computed && !edge.finiteTargets) return ['computed-target-unbounded'];
  if (from.owner !== to.owner && to.visibility === 'private') return ['private-owner-import'];
  if (from.owner === to.owner && from.subowner && to.subowner && from.subowner !== to.subowner && to.visibility === 'private') return ['private-subowner-import'];
  if (from.generic && to.category === 'product') return ['generic-host-depends-on-product'];
  if (to.kind === 'declarative-household-naming') return edge.symbol === 'appConfigRelPath' && edge.operation === 'lookup' ? [] : ['unapproved-contract-export-or-operation'];
  if (from.layer === 'adapter' && to.kind === 'application-port') return edge.extendsPort === true ? [] : ['adapter-port-not-extended'];
  if (from.layer === 'domain' && to.layer === 'domain' && from.context !== to.context) {
    if (!Number.isInteger(from.rank) || !Number.isInteger(to.rank)) return ['unknown-domain-rank'];
    if (to.rank >= from.rank) return ['rank-review-required'];
  }
  const forbidden = {
    api: ['application', 'domain', 'adapter', 'rendering'],
    application: ['adapter', 'rendering'],
    domain: ['system', 'application', 'api', 'adapter', 'rendering'],
    system: ['application', 'adapter', 'api', 'rendering']
  };
  return forbidden[from.layer]?.includes(to.layer) ? ['forbidden-layer-edge'] : [];
}
const app = {
  owner: 'gratitude',
  layer: 'application',
  visibility: 'public'
};
const api = {
  owner: 'gratitude',
  layer: 'api',
  visibility: 'public'
};
const prototypeEntries = new Map([
  ['@daylight/gratitude/server/commands', { reExport: '#modules/gratitude/server/application/commands.mjs' }],
  ['#modules/gratitude/server/application/commands.mjs', { ...app, subowner: 'workflow', visibility: 'public' }],
  ['#modules/gratitude/server/adapters/yaml-store.mjs', { ...app, layer: 'adapter', subowner: 'storage', visibility: 'private' }]
]);
function resolvePrototypeTarget(specifier, edge = {}) {
  const candidates = edge.computed ? edge.finiteTargets : [specifier];
  if (!Array.isArray(candidates) || !candidates.length) return { error: 'computed-target-unbounded' };
  const targets = candidates.map(candidate => {
    let entry = prototypeEntries.get(candidate);
    const seen = new Set();
    while (entry?.reExport) {
      if (seen.has(candidate)) return null;
      seen.add(candidate);
      entry = prototypeEntries.get(entry.reExport);
    }
    return entry || null;
  });
  return targets.some(target => !target) ? { error: 'unclassified-source-or-target' } : { targets };
}
test('CASE-ARCH-PROTOTYPE-UNKNOWN prototype rejects unclassified source and restored metadata passes', () => {
  assert.deepEqual(violations(null, app), ['unclassified-source-or-target']);
  assert.deepEqual(violations({
    ...app
  }, app), []);
});
test('CASE-ARCH-PROTOTYPE-LAYER resolved public facade retains its executable layer', () => {
  assert.deepEqual(violations(api, app), ['forbidden-layer-edge']);
  assert.deepEqual(violations({
    ...api,
    layer: 'composition'
  }, app), []);
});
test('CASE-ARCH-PROTOTYPE-ALIAS re-export alias resolves to executable target layer', () => {
  const resolved = resolvePrototypeTarget('@daylight/gratitude/server/commands');
  assert.equal(resolved.error, undefined);
  assert.deepEqual(violations(api, resolved.targets[0]), ['forbidden-layer-edge']);
});
test('CASE-ARCH-PROTOTYPE-PRIVATE owner privacy survives package alias spelling', () => {
  assert.deepEqual(violations({
    ...app,
    owner: 'feed'
  }, {
    ...app,
    visibility: 'private'
  }), ['private-owner-import']);
  assert.deepEqual(violations({
    ...app,
    owner: 'feed'
  }, app), []);
});
test('CASE-ARCH-PROTOTYPE-SUBOWNER private facet rejects a sibling subowner import', () => {
  const resolved = resolvePrototypeTarget('#modules/gratitude/server/adapters/yaml-store.mjs');
  const adapter = { ...app, layer: 'adapter' };
  assert.deepEqual(violations({ ...adapter, subowner: 'workflow' }, resolved.targets[0]), ['private-subowner-import']);
  assert.deepEqual(violations({ ...adapter, subowner: 'storage' }, resolved.targets[0]), []);
});
test('CASE-ARCH-PROTOTYPE-PORT implemented application port is not workflow permission', () => {
  const adapter = {
    owner: 'gratitude',
    layer: 'adapter'
  };
  const port = {
    ...app,
    kind: 'application-port'
  };
  assert.deepEqual(violations(adapter, port), ['adapter-port-not-extended']);
  assert.deepEqual(violations(adapter, port, {
    extendsPort: true
  }), []);
});
test('CASE-ARCH-PROTOTYPE-NAMING closed household lookup does not allow arbitrary builders', () => {
  const naming = {
    owner: 'contracts',
    kind: 'declarative-household-naming'
  };
  assert.deepEqual(violations(app, naming, {
    symbol: 'appConfigRelPath',
    operation: 'lookup'
  }), []);
  assert.deepEqual(violations(app, naming, {
    symbol: 'buildClockedEnvelope',
    operation: 'execute'
  }), ['unapproved-contract-export-or-operation']);
});
test('CASE-ARCH-PROTOTYPE-HOST generic screen host uses injected experience without product import', () => {
  const host = {
    owner: 'screen-host',
    generic: true,
    layer: 'browser'
  };
  assert.deepEqual(violations(host, {
    owner: 'piano',
    category: 'product'
  }), ['generic-host-depends-on-product']);
  assert.deepEqual(violations(host, {
    owner: 'screen-host',
    category: 'platform'
  }), []);
});
test('CASE-ARCH-PROTOTYPE-RANK unknown and equal ranks stop pending authoritative ruling', () => {
  const d = {
    owner: 'gratitude',
    layer: 'domain',
    context: 'gratitude',
    rank: 2
  };
  assert.deepEqual(violations(d, {
    ...d,
    context: 'books',
    rank: null
  }), ['unknown-domain-rank']);
  assert.deepEqual(violations(d, {
    ...d,
    context: 'piano'
  }), ['rank-review-required']);
  assert.deepEqual(violations(d, {
    ...d,
    context: 'core',
    rank: 0
  }), []);
});
test('CASE-ARCH-PROTOTYPE-COMPUTED finite target evidence is required', () => {
  assert.deepEqual(violations(app, app, {
    computed: true
  }), ['computed-target-unbounded']);
  assert.deepEqual(violations(app, app, {
    computed: true,
    finiteTargets: ['known-entry']
  }), []);
  assert.equal(resolvePrototypeTarget('@daylight/gratitude/server/commands', {
    computed: true,
    finiteTargets: ['@daylight/gratitude/server/commands']
  }).targets.length, 1);
  assert.deepEqual(resolvePrototypeTarget('@daylight/gratitude/server/commands', {
    computed: true,
    finiteTargets: ['@daylight/missing']
  }), { error: 'unclassified-source-or-target' });
});
