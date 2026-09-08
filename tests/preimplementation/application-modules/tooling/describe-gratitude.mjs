/** Source-backed preparation ledgers. Specifications are not applied changes. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, packet, emit } from './census.mjs';
const source = JSON.parse(fs.readFileSync(path.join(packet, 'source-ledger.json')));
const graph = JSON.parse(fs.readFileSync(path.join(packet, 'dependency-ledger.json')));
const files = new Map(source.files.map(f => [f.path, f]));
const edgesFrom = new Map();
for (const e of graph.edges) {
  const list = edgesFrom.get(e.from) || [];
  list.push(e);
  edgesFrom.set(e.from, list);
}
function closure(seeds, omitBootstrap = false) {
  const seen = new Set(seeds),
    queue = [...seeds];
  while (queue.length) {
    for (const e of edgesFrom.get(queue.pop()) || []) {
      if (e.kind !== 'source' || omitBootstrap && e.target === 'backend/src/5_composition/bootstrap.mjs') continue;
      if (!seen.has(e.target)) {
        seen.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return [...seen].sort();
}
const seeds = ['backend/src/5_composition/modules/gratitudeApi.mjs', 'backend/src/3_applications/gratitude/services/GratitudeService.mjs', 'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs', 'backend/src/1_rendering/gratitude/GratitudeCardRenderer.mjs', 'backend/src/3_applications/gratitude/services/GratitudePrintPresentationService.mjs', 'frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx', 'frontend/src/modules/Admin/Apps/GratitudeConfig.jsx'];
function destination(name) {
  for (const [from, to] of [['backend/src/2_domains/gratitude/', 'modules/gratitude/server/domain/gratitude/'], ['backend/src/3_applications/gratitude/', 'modules/gratitude/server/application/'], ['backend/src/1_rendering/gratitude/', 'modules/gratitude/server/rendering/'], ['frontend/src/modules/AppContainer/Apps/Gratitude/', 'modules/gratitude/web/surfaces/'], ['tests/unit/domains/gratitude/', 'modules/gratitude/tests/domain/']]) if (name.startsWith(from)) return to + name.slice(from.length);
  return {
    'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs': 'modules/gratitude/server/adapters/yaml/YamlGratitudeDatastore.mjs',
    'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs': 'modules/gratitude/server/adapters/print/TemporaryImagePrintGateway.mjs',
    'backend/src/4_api/v1/routers/gratitude.mjs': 'modules/gratitude/server/api/v1/gratitude.mjs',
    'backend/src/4_api/v1/routers/gratitude.card.test.mjs': 'modules/gratitude/server/api/v1/gratitude.card.test.mjs',
    'backend/src/5_composition/modules/gratitudeApi.mjs': 'modules/gratitude/server/composition/gratitudeApi.mjs',
    'frontend/src/modules/Admin/Apps/GratitudeConfig.jsx': 'modules/gratitude/web/surfaces/GratitudeConfig.jsx',
    'frontend/src/assets/app-icons/gratitude.svg': 'modules/gratitude/web/assets/gratitude.svg',
    'frontend/src/assets/icons/thanks.svg': 'modules/gratitude/web/assets/thanks.svg',
    'frontend/src/assets/icons/hopes.svg': 'modules/gratitude/web/assets/hopes.svg'
  }[name] || null;
}
function layer(name) {
  if (/\.(test|spec)\./.test(name) || name.startsWith('tests/')) return 'test';
  if (name.startsWith('frontend/')) return /\.(svg|scss)$/.test(name) ? 'browser-resource' : 'browser';
  return name.match(/backend\/src\/\d_([^/]+)/)?.[1] || 'unclassified';
}
const moves = source.files.filter(f => destination(f.path)).map(f => ({
  source: f.id,
  old: f.path,
  new: destination(f.path),
  sha256: f.sha256,
  mode: f.mode,
  owner: 'gratitude',
  category: 'product',
  runtime: f.path.startsWith('frontend/') ? 'browser' : f.path.startsWith('tests/') ? 'test' : 'server',
  layer: layer(f.path),
  context: layer(f.path) === 'domains' ? 'gratitude' : null,
  rank: layer(f.path) === 'domains' ? 2 : null,
  disposition: 'proposed move; not performed',
  symbols: graph.exports.filter(e => e.from === f.path),
  consumers: graph.edges.filter(e => e.target === f.path).map(e => ({
    file: e.from,
    line: e.line,
    specifier: e.specifier
  })),
  contractIds: ['CTR-GR-ARTIFACT-01'],
  review: 'source identity confirmed; final public replacement/closure review still required'
}));
const candidateClosure = closure(seeds, true);
const foundation = candidateClosure.filter(name => !destination(name)).map(name => ({
  source: files.get(name)?.id,
  path: name,
  layer: layer(name),
  owner: name.startsWith('frontend/src/modules/Admin/') || name.startsWith('frontend/src/hooks/admin/') ? 'admin' : name === 'shared/contracts/householdConfig.mjs' ? 'contracts' : name.includes('RealtimePublications') ? 'split-publications-by-owner' : 'platform',
  disposition: name.includes('RealtimePublications') ? 'extract GratitudeEvents only; preserve other exports' : 'specify exact public entry and source location before move approval',
  consumers: graph.edges.filter(e => e.target === name).map(e => ({
    file: e.from,
    line: e.line,
    specifier: e.specifier
  })),
  blockingDecision: 'DEC-FOUNDATION-CLOSURE'
}));
const publicEntries = [{
  entry: '@daylight/gratitude/server/adapters/image-print-gateway',
  layer: 'adapter',
  symbols: ['default', 'TemporaryImagePrintGateway'],
  implementationSource: 'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs',
  implementationDestination: 'modules/gratitude/server/adapters/print/TemporaryImagePrintGateway.mjs',
  facade: 'modules/gratitude/public/server/adapters/image-print-gateway.mjs',
  facadeExport: {subpath:'./server/adapters/image-print-gateway',target:'./server/adapters/image-print-gateway.mjs'},
  privateFacetExport: {package:'@daylight-internal/gratitude--server',subpath:'./image-print-gateway',target:'./adapters/print/TemporaryImagePrintGateway.mjs'},
  forwardingSource: "export { default, TemporaryImagePrintGateway } from '@daylight-internal/gratitude--server/image-print-gateway';",
  basis: ['backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.mjs:7', 'backend/src/5_composition/modules/fitnessApi.mjs:13'],
  consumers: ['backend/src/5_composition/modules/fitnessApi.mjs', 'backend/src/1_adapters/hardware/thermal-printer/TemporaryImagePrintGateway.test.mjs'],
  ownerInternalConsumer: 'modules/gratitude/server/composition/gratitudeApi.mjs uses ../adapters/print/TemporaryImagePrintGateway.mjs',
  contractIds: ['CTR-GR-PRINT-03'],
  caseIds: ['CASE-GR-TEMP-CLEANUP-false','CASE-GR-TEMP-CLEANUP-true','CASE-GR-TEMP-CONTRACT','CASE-EXISTING-GR-PRINT-01'],
  contract: 'One default/named class identity; actual extends of private application IImagePrintGateway; OS temp naming, raw bytes, options/result/error identity and best-effort cleanup unchanged. No renderer or product composition loaded by this entry.',
  decision: 'DEC-PRINT-EXPORT: exact source/entry selection, not an approved package or migration. Adapter belongs to Gratitude despite Fitness reuse.',
  prerequisite: 'IMP-BASE.02 must adjudicate the existing raw path prohibition and OS-temp capability ownership without a new exemption; IMP-PKG and shared FileIO identity/public-boundary gates remain open',
  forbiddenConsumers: ['application/domain concrete-adapter imports','peer adapters/renderers','browser code','cross-owner private port or internal facet imports']
}, {
  entry: '@daylight/gratitude/server/compose',
  layer: 'composition',
  symbols: ['createGratitudeServices', 'createGratitudeApiRouter'],
  basis: ['backend/src/5_composition/bootstrap.mjs:1920', 'backend/src/5_composition/modules/gratitudeApi.mjs:25'],
  consumers: ['backend/src/app.mjs'],
  prerequisite: 'extract real factory; remove unused global-bootstrap import; no global startup in facade'
}, {
  entry: '@daylight/gratitude/web/surface',
  layer: 'browser',
  symbols: ['default (Gratitude)'],
  basis: ['frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx:993'],
  consumers: ['frontend/src/lib/appRegistry.js'],
  contract: 'clear callback preserved; app ID and bootstrap URL unchanged'
}, {
  entry: '@daylight/gratitude/web/settings',
  layer: 'browser',
  symbols: ['default (GratitudeConfig)'],
  basis: ['frontend/src/modules/Admin/Apps/GratitudeConfig.jsx'],
  consumers: ['frontend/src/modules/Admin/Apps/AppConfigEditor.jsx'],
  contract: 'configPath(gratitude), form/unsaved context and write shape preserved'
}, {
  entry: '@daylight/gratitude/web/icon',
  layer: 'browser-resource',
  symbols: ['default URL'],
  basis: ['frontend/src/assets/app-icons/gratitude.svg'],
  consumers: ['frontend/src/lib/appRegistry.js'],
  contract: 'same asset bytes, bundler URL only, not a server export'
}];
emit('owner-boundaries.json', {
  schema: 'daylight.preimplementation.owners/v1',
  baseline: source.baseline,
  status: 'source-backed proposal; not approved for execution',
  boundaryRefinements: [{specification:'utility-boundary.json',decision:'DEC-UTILITY-EXPORTS',
    scope:'17 system utility/domain core candidates; selected public entries and exact source-import replacements supersede mechanical proposals',
    limits:'Full reference/package/combined-candidate gates remain open; not whole-foundation approval'},
    {specification:'fileio-boundary.json',decision:'DEC-FILEIO-EXPORTS',
      scope:'Single private filesystem implementation; selected 73-name public entry, four retained private exports and exact source/mock import changes',
      limits:'Full reference/namespace/native candidate/package/layer gates remain open; original six-suite baseline is not migration parity'},
    {specification:'http-boundary.json',decision:'DEC-HTTP-MIDDLEWARE',
      scope:'Four cohesive system middleware files, one public four-name entry, 82 imports, four guide spellings and one School predicate replacement; private barrel retained',
      limits:'Original loading closure, ten original error cases and 37 dedicated memory-only cases; full controller/socket/consumer/native package gates remain open'},
    {specification:'logging-boundary.json',decision:'DEC-LOGGING-BOUNDARY',
      scope:'Three unchanged system bodies, three runtime entries/five names, one test-only entry/three names, 32 import/reference edits and gated zero-caller aggregate retirement',
      limits:'Twelve native fixture probes and duplicate/leak controls supplement 54 original logging cases; actual caller-role enforcement, full package adoption and affected-suite parity remain open'}],
  owner: {
    id: 'gratitude',
    category: 'product',
    metadataRole: 'tooling only, never activation',
    root: 'modules/gratitude',
    rootIsPackage: false,
    facets: [{
      path: 'modules/gratitude/public',
      name: '@daylight/gratitude'
    }, {
      path: 'modules/gratitude/server',
      name: '@daylight-internal/gratitude--server'
    }, {
      path: 'modules/gratitude/web',
      name: '@daylight-internal/gratitude--web'
    }],
    contexts: [{
      id: 'gratitude',
      rank: 2,
      source: 'domain'
    }]
  },
  publicEntries,
  publicOperations: [{
    id:'gratitude.read-selection-quotes',owner:'gratitude',layer:'application',runtime:'server',
    throughEntry:'@daylight/gratitude/server/compose',factory:'createGratitudeServices',
    returnedMember:'gratitudeQueries.readSelectionQuotes',
    implementation:'modules/gratitude/server/application/queries/GratitudeSelectionQuery.mjs',
    port:'modules/gratitude/server/application/ports/IGratitudeQuoteSource.mjs',
    adapter:'modules/gratitude/server/adapters/yaml/YamlGratitudeQuoteSource.mjs',
    signature:'readSelectionQuotes(): null | Iterable<GratitudeQuoteView>; synchronous, no arguments',
    view:'Local lazy text/userId/datetime properties; not a serializable DTO. Iteration preserves order/holes; interpretation occurs only when Feed accesses selected rows.',
    binding:'backend/src/app.mjs passes gratitudeServices.gratitudeQueries.readSelectionQuotes as readGratitudeQuotes to the retained GratitudeFeedAdapter',
    visibility:'Only the composition entry is imported across owners; query/reader/port remain private. No unused server/queries module entry, new HTTP route or Feed-to-Gratitude source import.',
    contractIds:['CTR-GR-CONSUMER-02'],decision:'DEC-FEED-QUERY',specification:'feed-boundary.json',
    status:'exact interface selected; implementation and native candidate proof not performed'
  }, {
    id:'gratitude.add-selections',owner:'gratitude',layer:'application',runtime:'server',
    throughEntry:'@daylight/gratitude/server/compose',factory:'createGratitudeServices',
    returnedMember:'gratitudeCommands.addSelections',
    implementation:'modules/gratitude/server/application/services/GratitudeService.mjs#addSelections',
    signature:'addSelections(householdId, category, userId, items, timestamp): Promise<Selection[]>',
    binding:'backend/src/app.mjs passes gratitudeServices.gratitudeCommands.addSelections as addGratitudeSelections to createHomebotServices; composition constructs the Homebot-owned gateway adapter',
    visibility:'Returned bound command, not an unused server/commands module export. Homebot receives its own application port; no private Gratitude import or datastore knowledge.',
    contractIds:['CTR-GR-CONSUMER-03'],decision:'DEC-HOMEBOT-COMMAND',specification:'homebot-boundary.json',
    status:'exact command binding selected; implementation and native candidate proof not performed'
  }],
  sharedCapabilities: [{
    id:'household-identity',category:'capability',root:'capabilities/household-identity',rootIsPackage:false,
    facets:[{path:'capabilities/household-identity/public',name:'@daylight/household-identity'},
      {path:'capabilities/household-identity/server',name:'@daylight-internal/household-identity--server'},
      {path:'capabilities/household-identity/web',name:'@daylight-internal/household-identity--web'}],
    contexts:[],
    publicEntries:[{entry:'@daylight/household-identity/server/compose',layer:'composition',runtime:'server',symbols:['createHouseholdIdentityServices']},
      {entry:'@daylight/household-identity/web/roster-client',layer:'browser',runtime:'browser',symbols:['fetchHouseholdRosterResponse']}],
    returnedOperations:{factory:'createHouseholdIdentityServices',member:'householdPresentation',layer:'application',runtime:'server',
      methods:['getDefaultHouseholdId','getTimezone','getHouseholdUsers','resolveDisplayName']},
    specification:'household-boundary.json',decision:'DEC-IDENTITY',
    status:'selected presentation/query/client boundary; package adoption, owner metadata targets and native candidate gates remain separate',
    preserve:'No category policy, timestamp generation, fresh-disk read, auth scope, new HTTP route or changed roster/name projection. Existing Homebot and ConfigUserDirectory policies are not replaced.'
  }],
  moves,
  foundation,
  closures: seeds.map(seed => ({
    seed,
    actual: closure([seed]),
    proposedWithoutGlobalBootstrap: closure([seed], true),
    note: 'omitting an edge is a proposed prerequisite, not existing-code evidence'
  })),
  externalConsumers: [{
    owner: 'feed',
    retain: ['backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs', 'frontend/src/modules/Feed/Scroll/cards/bodies/GratitudeBody.jsx']
  }, {
    owner: 'homebot',
    retain: ['backend/src/3_applications/homebot/usecases/AssignItemToUser.mjs', 'backend/src/3_applications/homebot/usecases/ProcessGratitudeInput.mjs', 'backend/src/3_applications/homebot/usecases/CancelGratitudeInput.mjs']
  }, {
    owner: 'household identity/family selector',
    retain: ['frontend/src/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx'],
    behavior: 'URL compatibility remains; generic household projection split must not change names/order'
  }],
  unresolved: ['DEC-FOUNDATION-CLOSURE', 'DEC-FEED-QUERY', 'DEC-PACKAGE-REAL-GRAPH', 'DEC-POLICY-RANKS']
});
const resources = source.files.filter(f => f.mode === '120000' || /\.(svg|png|jpe?g|webp|gif|ttf|woff2?|wasm|scss|css|json|ya?ml)$/.test(f.path)).map(f => ({
  source: f.id,
  path: f.path,
  sha256: f.sha256,
  mode: f.mode,
  bytes: f.bytes,
  disposition: destination(f.path) ? 'Gratitude move candidate' : 'retained until owner/resource review',
  consumers: graph.edges.filter(e => e.target === f.path).map(e => ({
    file: e.from,
    line: e.line
  })),
  gap: 'non-import URL/glob consumers require review'
}));
const extensions = [...new Set(source.files.filter(f => f.path.startsWith('_extensions/')).map(f => f.path.split('/')[1]))].sort().map(name => ({
  id: name,
  sourceRoot: '_extensions/' + name,
  sourceFiles: source.files.filter(f => f.path.startsWith('_extensions/' + name + '/')).map(f => f.id),
  manifestAndBuildInputs: source.files.filter(f => f.path.startsWith('_extensions/' + name + '/') && /package(-lock)?\.json|requirements|platformio|build\.gradle|CMakeLists|Makefile|Cargo|Dockerfile|pyproject|\.sh$/.test(f.path)).map(f => ({
    path: f.path,
    sha256: f.sha256
  })),
  disposition: 'retain independent runtime path; logical owner seed in source-area inventory section 6',
  protocolReview: 'not complete',
  decisionOwner: 'domain/device reviewer',
  blockingPackage: 'later owner/satellite migration; do not flash under this plan'
}));
emit('assets-and-storage.json', {
  schema: 'daylight.preimplementation.resources/v1',
  baseline: source.baseline,
  resources,
  extensions,
  authorityReview: {artifact:'storage-authorities.json', narrative:'storage-authorities.md',
    scope:'12 reviewed first-move/shared authorities; broader FileIO consumer namespaces remain open'},
  resourceReview:{artifact:'resource-review.json',narrative:'resource-review.md',scope:'source/resource links, SVG glob expansion, conditional bundled-font rewrites, workers and installed shell; compiler/image parity remains separate'},
  gratitudeStorage: {
    namespace: 'household-scoped gratitude',
    arrays: ['options.gratitude.yml', 'options.hopes.yml', 'selections.gratitude.yml', 'selections.hopes.yml', 'discarded.gratitude.yml', 'discarded.hopes.yml'],
    writer: 'backend/src/1_adapters/persistence/yaml/YamlGratitudeDatastore.mjs',
    readers: ['same datastore', 'backend/src/1_adapters/feed/sources/GratitudeFeedAdapter.mjs'],
    codecs: ['DataService household read/write for arrays', 'system FileIO loadYamlSafe/saveYaml for snapshots'],
    snapshots: 'gratitude/snapshots/<wall-clock>_<UUID>.yml',
    behavior: ['explicit .yml suffix is required for dotted keys', 'selection DTO hydrates entities; stored object has id/userId/item/datetime/printed', 'missing array becomes []', 'getOptions/bootstrap may recycle discarded with writes', 'unknown snapshot ID falls back to latest if any exist', 'Feed accepts nested item.text, string item, then top-level text'],
    concurrency: 'DataService writes through saveYamlToPath (synchronous whole-file write), not saveYamlToPathAtomic; read-modify-write spans separate calls with no transaction/lock. Preserve, do not silently improve.',
    modes: 'no explicit per-file mode supplied on saveYamlToPath writeFileSync; existing-file mode retained by normal filesystem write, new files depend on process umask. No migration permission change authorized.',
    cache: 'DataService readYamlFile calls loadYamlFromPath on every read; no value cache. ConfigService household app values are a loaded snapshot updated by explicit reloadHouseholdAppConfig. Both behaviors exercised against synthetic disk.',
    authorities: {dataService:'backend/src/1_adapters/persistence/files/DataService.mjs:88',householdPath:'backend/src/0_system/config/ConfigService.mjs:356',yamlRead:'backend/src/0_system/utils/FileIO.mjs:574',yamlWrite:'backend/src/0_system/utils/FileIO.mjs:605',configReload:'backend/src/0_system/config/ConfigService.mjs:246',writeFailure:'DataService returns false on caught write errors; Gratitude #writeArray does not inspect that result (source finding, separate behavior question)'},
    evidence: 'real datastore + synthetic DataService and actual temporary snapshot YAML cases'
  },
  publicAssets: {
    avatarUrls: '/static/img/users/<id> and /static/img/users/user',
    font: 'backend/assets/fonts/roboto-condensed/RobotoCondensed-Regular.ttf',
    runtimeFontOverride: 'app.mjs resolves deployment font directory; production override bytes not captured',
    immutableClientClosure: 'not yet built; candidate/baseline lazy-asset proof pending'
  }
});
const routeText = fs.readFileSync(path.join(root, 'backend/src/4_api/v1/routers/gratitude.mjs'), 'utf8');
const routes = [...routeText.matchAll(/router\.(get|post|delete)\('([^']+)'/g)].map((m, i) => ({
  id: 'CTR-GR-HTTP-' + String(i + 1).padStart(2, '0'),
  method: m[1].toUpperCase(),
  pattern: '/api/v1/gratitude' + m[2],
  source: 'backend/src/4_api/v1/routers/gratitude.mjs',
  line: routeText.slice(0, m.index).split('\n').length,
  owner: 'gratitude',
  consumer: 'installed browser/API callers',
  preconditions: 'fresh synthetic household; see dedicated driver',
  inputOracle: 'named request/body/query and assertions in cases/gratitude.case.mjs',
  middleware: ['request logging', 'device resolver', 'household resolver', 'network trust', 'token resolver', 'permission gate', 'createApiRouter routeMap /gratitude', 'Gratitude router', 'errorHandlerMiddleware default object shape'],
  runtimeCoverage: 'real route + real API mount map + permission gate only; global startup/auth token pipeline not executed',
  casePrefix: 'CASE-GR-HTTP-' + String(i + 1).padStart(2, '0'),
  candidate: 'pending; no migrated code exists'
}));
const evidence = fs.readdirSync(path.join(packet, 'evidence')).filter(f => f.endsWith('.json')).map(name => ({
  name,
  ...JSON.parse(fs.readFileSync(path.join(packet, 'evidence', name)))
}));
const isFresh = run => run.inputs?.length > 4 && run.inputs.every(input => {
  const full = path.join(run.inputBase === 'repository root' ? root : path.join(root, 'tests/preimplementation/application-modules'), input.name);
  return fs.existsSync(full) && createHash('sha256').update(fs.readFileSync(full)).digest('hex') === input.sha256;
});
const newest = {};
for (const run of evidence.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) if (typeof run.pack==='string' && Array.isArray(run.passed) && !run.mutation && isFresh(run)) newest[run.pack] = run;
const cases = Object.values(newest).flatMap(run => [...run.passed.map(title=>({title,result:'passed'})),...(run.failed||[]).map(title=>({title,result:'failed'}))].map(({title,result}) => ({
  id: title.split(' ')[0],
  description: title,
  runner: 'node:test',
  source: 'tests/preimplementation/application-modules/cases/' + run.pack + '.case.mjs',
  baselineResult: result,
  evidence: 'evidence/' + run.name,
  candidateResult: 'candidate-pending',
  expectationBasis: 'source-reviewed explicit assertions; not a blindly recorded response snapshot',
  normalization: 'no blanket normalization; IDs/times checked by shape and relationships; fixed Date for pixel flip'
})));
emit('contracts.json', {
  schema: 'daylight.preimplementation.contracts/v1',
  baseline: source.baseline,
  status: 'HTTP/storage/print/Feed/Homebot baseline subset executed; not complete contract catalog',
  contracts: routes,
  cases,
  gaps: [{
    id: 'GAP-GR-UI',
    owner: 'test owner',
    scope: 'real browser interaction, context/event cleanup, FamilySelector and Admin workflows',
    next: 'dedicated fake-backed browser pack; no live controller'
  }, {
    id: 'GAP-GR-ASSEMBLY',
    owner: 'architecture/test owner',
    scope: 'global app startup, full auth pipeline and lifecycle',
    next: 'exact future composition extraction card; never start controller to fill gap'
  }, {
    id: 'GAP-GR-IMAGE',
    owner: 'build reviewer',
    scope: 'Linux/native production image and already-loaded client asset closure',
    next: 'isolated image/source certification after immutable inputs are known'
  }, {
    id: 'GAP-REPO-REGISTRATIONS',
    owner: 'investigation lead',
    scope: 'all non-Gratitude registration candidates',
    next: 'resolve mount/catalog ownership and assign per-owner test coverage before their moves'
  }]
});
process.stdout.write(JSON.stringify({
  moves: moves.length,
  foundation: foundation.length,
  resources: resources.length,
  extensions: extensions.length,
  gratitudeRoutes: routes.length,
  executedCases: cases.length
}) + '\n');
