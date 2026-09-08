/** Proposed semantic boundaries and exact source-edge impact, never source edits. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {root, packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const graph = read('dependency-ledger.json'), owners = read('owner-boundaries.json');
const source = read('source-ledger.json'), files = new Map(source.files.map(f => [f.path, f]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const edges = new Map(), declared = new Map();
for (const e of graph.edges) edges.set(e.from, [...(edges.get(e.from) || []), e]);
for (const e of graph.exports) declared.set(e.from, [...(declared.get(e.from) || []), e]);
const slug = text => text.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const stem = file => file.replace(/\.(mjs|jsx|js)$/, '').split('/').map(slug).join('/');
const mixed = 'backend/src/3_applications/events/RealtimePublications.mjs';
const configNaming = 'shared/contracts/householdConfig.mjs';
const adminPaths = {
  'frontend/src/hooks/admin/useAdminConfig.js': ['hooks/useAdminConfig.js', 'web/config/use-admin-config'],
  'frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx': ['shared/ConfigFormWrapper.jsx', 'web/config/form'],
  'frontend/src/modules/Admin/shared/CrudTable.jsx': ['shared/CrudTable.jsx', 'web/config/crud-table'],
  'frontend/src/modules/Admin/shared/SaveBar.jsx': ['shared/SaveBar.jsx', 'web/config/save-bar'],
  'frontend/src/modules/Admin/shared/UnsavedGuardContext.jsx': ['shared/UnsavedGuardContext.jsx', 'web/config/unsaved-context'],
  'frontend/src/modules/Admin/shared/useUnsavedGuard.js': ['shared/useUnsavedGuard.js', 'web/config/use-unsaved-guard'],
  'frontend/src/modules/Admin/shared/useUnsavedGuardRegistry.js': ['shared/useUnsavedGuardRegistry.js', 'web/config/use-unsaved-registry'],
  'frontend/src/modules/Admin/utils/adminConfigPaths.js': ['utils/adminConfigPaths.js', 'web/config/paths'],
};
const browserPaths = {
  'frontend/src/contexts/WebSocketContext.jsx': ['contexts/WebSocketContext.jsx', 'web/realtime/context'],
  'frontend/src/services/WebSocketService.js': ['services/WebSocketService.js', 'web/realtime/service'],
  'frontend/src/lib/api.mjs': ['lib/api.mjs', 'web/http'],
  'frontend/src/lib/deviceIdentity.js': ['lib/deviceIdentity.js', 'web/device-identity'],
  'frontend/src/lib/perf/memoryProbe.js': ['lib/perf/memoryProbe.js', 'web/diagnostics/memory'],
};

function classify(file) {
  if (file === mixed) return {owner: 'mixed', category: null, runtime: 'server', layer: 'application',
    subowner: null, context: null, rank: null, proposedPath: null, entry: null,
    change: 'split only GratitudeEvents; other four classes and installed consumers stay in place'};
  if (file === configNaming) return {owner: 'contracts', category: 'platform', runtime: 'universal',
    layer: null, contractKind: 'closed-household-config-naming', context: null, rank: null,
    subowner: 'household-config', proposedPath: file, entry: '@daylight/contracts/household-config',
    change: 'publish only the immutable registry; appConfigRelPath/allAppNames are executable system helpers requiring a separate private extraction'};
  if (adminPaths[file]) return {owner: 'admin', category: 'product', runtime: 'browser', layer: 'browser',
    subowner: 'config-editor', context: null, rank: null, proposedPath: 'modules/admin/web/' + adminPaths[file][0],
    entry: '@daylight/admin/' + adminPaths[file][1],
    change: 'owned shared editor prerequisite, not migration of Admin routes or the whole Admin product'};
  const mappings = [
    ['backend/src/0_system/', 'platform/server/system/', 'system', null, 'server/system/'],
    ['backend/src/2_domains/core/', 'platform/server/domain/core/', 'domain', 'core', 'server/domain/core/'],
    ['backend/src/1_rendering/lib/', 'platform/server/rendering/', 'rendering', null, 'server/rendering/'],
  ];
  for (const [prefix, destination, layer, context, publicPrefix] of mappings) if (file.startsWith(prefix)) {
    const suffix = file.slice(prefix.length);
    return {owner: 'platform', category: 'platform', runtime: 'server', layer,
      subowner: layer === 'domain' ? 'domain-core' : layer, context, rank: context ? 0 : null,
      proposedPath: destination + suffix,
      entry: '@daylight/platform/' + publicPrefix + stem(suffix).replace(/\/index$/, ''),
      change: 'candidate foundation relocation; import/resource rewrites and complete reverse-impact tests required'};
  }
  if (file.startsWith('frontend/src/lib/logging/')) {
    const suffix = file.slice('frontend/src/lib/logging/'.length);
    return {owner: 'platform', category: 'platform', runtime: 'browser', layer: 'browser', subowner: 'observability',
      context: null, rank: null, proposedPath: 'platform/web/lib/logging/' + suffix,
      entry: '@daylight/platform/web/logging/' + (suffix === 'index.js' ? 'library' : stem(suffix)),
      change: 'single canonical logging graph; retain dynamic WebSocket imports and existing singleton identities'};
  }
  if (browserPaths[file]) return {owner: 'platform', category: 'platform', runtime: 'browser', layer: 'browser',
    subowner: file.includes('WebSocket') ? 'realtime' : file.includes('memoryProbe') ? 'observability' : 'client-transport',
    context: null, rank: null, proposedPath: 'platform/web/' + browserPaths[file][0],
    entry: '@daylight/platform/' + browserPaths[file][1],
    change: 'preserve browser-owned state and host identity; no new backend bootstrap dependency'};
  throw new Error('No reviewed foundation rule for ' + file);
}

function allNames(file, seen = new Set()) {
  if (seen.has(file)) return [];
  const next = new Set(seen).add(file);
  return [...new Set([...(declared.get(file) || []).map(e => e.name),
    ...(edges.get(file) || []).filter(e => e.syntax === 'ExportAllDeclaration' && e.kind === 'source')
      .flatMap(e => allNames(e.target, next).filter(name => name !== 'default'))])].sort();
}
function leaf(file, name, seen = new Set()) {
  const key = file + ':' + name;
  if (seen.has(key)) return {file, name, unresolved: 're-export cycle'};
  const next = new Set(seen).add(key);
  for (const e of edges.get(file) || []) {
    if (e.kind !== 'source') continue;
    if (e.syntax === 'ExportNamedDeclaration') {
      const symbol = e.symbols?.find(s => s.exported === name);
      if (symbol) return leaf(e.target, symbol.imported || symbol.local, next);
    }
    if (e.syntax === 'ExportAllDeclaration' && name !== 'default' && allNames(e.target).includes(name))
      return leaf(e.target, name, next);
  }
  return {file, name, unresolved: null};
}
function classifyExport(c, file, name) {
  if (file === configNaming) {
    if (name === 'HOUSEHOLD_APP_CONFIGS') return {
      classification: 'declarative-contract', proposedEntry: c.entry,
      visibility: 'public contract: immutable stable app-name to household-relative-path data only',
      preserve: 'same frozen object, keys, values, order and binding identity; no derived behavior is exported'};
    return {
      classification: 'executable-system-helper; future extraction required', proposedEntry: null,
      proposedSource: 'platform/server/system/config/householdConfigLookup.mjs',
      semanticLayer: 'system',
      visibility: 'private system implementation; not a shared/contracts export',
      preserve: name === 'appConfigRelPath'
        ? 'same registered-path-or-null result, including unknown-name behavior, using the one canonical registry object'
        : 'same fresh Object.keys result and registry enumeration order, using the one canonical registry object'};
  }
  return {
    classification: /^_|ForTest|reset.*State/.test(name) ? 'test/control-surface review required' : c.contractKind || c.layer,
    proposedEntry: c.entry,
    visibility: 'source private; only individually classified public entries are proposed',
    preserve: 'current name, default/named shape and binding identity; no functional replacement implied'};
}
const reviewed = owners.foundation.map(f => {
  const c = classify(f.path);
  const isIO = f.path.endsWith('/FileIO.mjs');
  const scope = c.owner === 'platform' && c.layer === 'domain' ? 'pure foundational domain logic; D4/core rank 0'
    : c.owner === 'admin' ? 'Admin config UI policy and provider identity; useful exports do not make it platform'
    : c.owner === 'contracts' ? 'only immutable name table and pure path/name lookups; no activation, codecs, clock or ports'
    : c.layer === 'rendering' ? 'drawing/font mechanics; application callers require presentation ports under D2'
    : isIO ? 'filesystem and storage primitives; D5/D10 prohibit direct application/domain use'
    : c.layer === 'system' ? 'runtime mechanics; preserve actual transitive layers, defaults and effects'
    : c.owner === 'mixed' ? 'individual application publication responsibilities; never publish the mixed barrel'
    : 'host/browser mechanics and state; no product selection or server code';
  return {sourceId: files.get(f.path).id, path: f.path, sha256: files.get(f.path).sha256,
    ...c, rationale: scope, visibility: 'source private; only individually classified public entries are proposed',
    exports: allNames(f.path).map(name => ({name, origin: leaf(f.path, name), ...classifyExport(c, f.path, name),
      consumers: graph.edges.filter(e => e.target === f.path && (e.symbols?.some(s => s.imported === name || s.imported === '*') || !e.symbols?.length)).map(e => e.id)})),
    stateConstraint: f.path.includes('Context') ? 'one context object and matching provider/consumer React instance'
      : /logging|WebSocketService|deviceIdentity|api\.mjs/.test(f.path) ? 'one current mutable instance per existing browser/server graph; do not merge unlike scopes'
      : /CanvasFactory/.test(f.path) ? 'same backend canvas instance and process-global registered fonts'
      : 'preserve captured dependency version and current state behavior',
    contractIds: c.owner === 'admin' ? ['CTR-GR-CONSUMER-04', 'CTR-PACKAGE-01']
      : c.layer === 'rendering' ? ['CTR-GR-PRINT-02', 'CTR-GR-ARTIFACT-01', 'CTR-PACKAGE-01']
      : c.layer === 'domain' ? ['CTR-ARCH-01', 'CTR-GR-DATA-01']
      : ['CTR-ARCH-01', 'CTR-ARCH-02', 'CTR-PACKAGE-01'],
    review: 'semantic source-area classification proposal; public-entry/consumer approval and full behavior coverage remain open'};
});
assert.equal(reviewed.length, 50);
const byPath = new Map(reviewed.map(r => [r.path, r]));
const replacements = graph.edges.filter(e => byPath.has(e.target)).map(e => {
  const target = byPath.get(e.target), named = e.symbols?.filter(s => s.imported && s.imported !== '*') || [];
  const targets = named.map(s => {
    // Split the system utility barrel by the actual re-exported symbol to avoid
    // dragging FileIO into a harmless clock/ID import. Other entries retain their
    // precise file closure until an explicit further split is approved.
    const origin = e.target === 'backend/src/0_system/utils/index.mjs' ? leaf(e.target, s.imported) : {file: e.target, name: s.imported};
    const destination = byPath.get(origin.file);
    const isGratitudeEvent = e.target === mixed && s.imported === 'GratitudeEvents';
    const exportReview = destination?.exports.find(x => x.name === origin.name);
    const executableContractHelper = origin.file === configNaming && exportReview?.proposedEntry === null;
    return {oldSymbol: s.imported, local: s.local, exported: s.exported,
      symbol: isGratitudeEvent ? 'GratitudeEvents' : origin.name,
      proposedEntry: isGratitudeEvent ? '@daylight/gratitude/server/events' : (exportReview ? exportReview.proposedEntry : destination?.entry) || null,
      proposedSource: isGratitudeEvent ? 'modules/gratitude/server/application/events/GratitudeEvents.mjs' : exportReview?.proposedSource || destination?.proposedPath || null,
      semanticLayer: isGratitudeEvent ? 'application' : exportReview?.semanticLayer || destination?.layer || null,
      unresolved: origin.unresolved || (executableContractHelper ? 'DEC-CONTRACT-SYMBOL-SPLIT: extract to private system config helper before rewriting this import' : null) || (e.target === mixed && !isGratitudeEvent ? 'retain original non-Gratitude publication and import' : null)};
  });
  return {edgeId: e.id, consumer: e.from, line: e.line, syntax: e.syntax, oldSpecifier: e.specifier,
    oldTarget: e.target, targets,
    fallbackEntry: named.length ? null : target.entry,
    disposition: e.target === mixed ? 'split named imports by owner; preserve other classes in original file'
      : named.length ? 'exact candidate symbol targets; approval still requires layer and instance checks'
      : 'namespace/side-effect/re-export-all edge: retain full closure; do not infer named usage from syntax',
    reviewGate: 'PRE-4.1.2/3 and affected-consumer tests; this is not an approved rewrite'};
});
assert.equal(replacements.length, owners.foundationImpact.incomingEdges);
assert.equal(new Set(replacements.map(r => r.edgeId)).size, replacements.length);
const entries = reviewed.flatMap(r => {
  const symbols = r.exports.filter(e => e.proposedEntry === r.entry).map(e => e.name);
  return r.entry && symbols.length ? [{entry: r.entry, source: r.proposedPath, owner: r.owner,
    layer: r.layer, context: r.context, rank: r.rank, symbols}] : [];
});
assert.equal(new Set(entries.map(e => e.entry)).size, entries.length);
const additionalResources = source.files.filter(f => f.path.startsWith('backend/assets/fonts/')).map(f => ({
  sourceId: f.id, path: f.path, sha256: f.sha256, mode: f.mode,
  candidate: 'platform/server/assets/fonts/' + f.path.slice('backend/assets/fonts/'.length),
  rule: 'font bytes and licenses travel together if bundled-font authority moves; deployment font override stays unchanged',
  blocker: 'RESOURCE-FONT-CONSUMERS: reconcile all URL/path consumers before selecting relocation or retained canonical asset authority'}));
emit('boundary-review.json', {schema: 'daylight.preimplementation.boundary-review/v1', baseline: source.baseline,
  status: 'proposed interfaces and classifications, not finalized/approved implementation',
  files: reviewed, entries, replacements, additionalResources,
  helperBarrelDecision: 'System utils imports split by exact exported symbol, preserving aliases such as ShortId→IdUtils. Domain consumers do not gain access to clocked/system/FileIO closure.',
  limits: ['Other publication exports retain original ownership; no automatic promotion to platform',
    'Named leaf targets preserve semantic layer; public names do not authorize prohibited edges',
    'Namespace/all and dynamic behavior need explicit per-consumer review',
    'A candidate destination does not count as an existing source or exported package',
    'All incoming edges are indexed, but this report is not complete per-edge approval or test coverage'],
  inputs: ['source-ledger.json', 'dependency-ledger.json', 'owner-boundaries.json'].map(name => ({name, sha256: sha(fs.readFileSync(path.join(packet, name)))})),
  toolHash: sha(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({classifiedFoundationFiles: reviewed.length, proposedEntries: entries.length,
  incomingReplacements: replacements.length, namedSymbols: replacements.reduce((n, r) => n + r.targets.length, 0),
  extraFontAssets: additionalResources.length}) + '\n');
