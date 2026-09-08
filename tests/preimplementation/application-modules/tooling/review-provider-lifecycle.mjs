/** Separate provider discovery, widget metadata and affected lifecycle seams. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {root, packet, emit} from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const review = read('registration-review.json'), graph = read('dependency-ledger.json'), owners = read('owner-boundaries.json');
const inputs = new Map();
function at(file, token) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  inputs.set(file, {path: file, sha256: hash(text)});
  const offset = text.indexOf(token);
  assert.ok(offset >= 0, 'Missing reviewed source anchor: ' + file + ':' + token);
  return {path: file, line: text.slice(0, offset).split('\n').length, anchor: token};
}
const integration = 'backend/src/5_composition/integrations/';
const discovery = at('backend/src/0_system/modules/FileModuleManifestDiscovery.mjs', 'async find(rootDir)');
const importOwner = at(discovery.path, 'return import(modulePath)');
const registry = at(integration + 'AdapterRegistry.mjs', 'async discover()');
const instantiate = at(integration + 'IntegrationLoader.mjs', 'await manifest.adapter()');
const config = at(integration + 'IntegrationLoader.mjs', '#buildAdapterConfig(householdId, provider, serviceConfig) {');
const initialized = at('backend/src/5_composition/bootstrap.mjs', 'export async function initializeIntegrations');
const bots = at(integration + 'SystemBotLoader.mjs', 'loadBots(deps = {})');
const routedAdapters = at(integration + 'HouseholdAdapters.mjs', 'get(capability, appName = null)');
const configuredKeys = at(integration + 'integrationConfigParser.mjs', 'export const PROVIDER_CAPABILITY_MAP');
function literal(manifest, name) {
  const text = manifest.fields.find(f => f.key === name)?.expression;
  assert.match(text || '', /^(['"])[^'"\n]+\1$/, 'Expected literal ' + name + ':' + manifest.path);
  return text.slice(1, -1);
}
const providerManifests = review.providerManifests.map(m => ({...m,
  capability: literal(m, 'capability'), provider: literal(m, 'provider'),
  adapterImports: graph.edges.filter(e => e.from === m.path && e.kind === 'source').map(e => ({edge: e.id, target: e.target, line: e.line})),
  enumerationOwner: discovery, importOwner, indexingOwner: registry, instantiationOwner: instantiate,
  configOwner: config, initializationOwner: initialized,
  activation: 'manifest discovery is not construction; config-driven IntegrationLoader and separately explicit bootstrap content registrations are different paths'
}));
assert.equal(providerManifests.length, 21);
const byKey = new Map();
for (const m of providerManifests) {
  const key = m.capability + '/' + m.provider;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(m.path);
}
const collisions = [...byKey].filter(([, paths]) => paths.length > 1).map(([key, paths]) => ({key, paths,
  currentPolicy: 'Map.set replaces the previous manifest; discovery filesystem order is not explicitly sorted',
  consequence: 'Relocating directories or changing enumeration order can change the selected adapter without changing a public key',
  requiredFutureDecision: 'Separate approved collision resolution from relocation; do not assume file-system order or silently choose one manifest',
  evidenceCase: 'CASE-PROVIDER-DUPLICATE'}));
assert.deepEqual(collisions.map(c => c.key), ['media/files']);
const fitnessFile = 'frontend/src/modules/Fitness/index.js';
const fitnessCatalog = review.catalogs.find(c => c.path === fitnessFile && c.name === 'REGISTRY_KEYS');
const fitnessAliases = review.catalogs.find(c => c.path === fitnessFile && c.name === 'LEGACY_ID_MAP');
assert.equal(fitnessCatalog.entries.length, 14); assert.equal(fitnessAliases.entries.length, 14);
const dashboard = review.lifecycleCalls.filter(c => c.path === fitnessFile && c.operation === 'register' && c.key);
assert.equal(dashboard.length, 10);
const sharedRegistry = at('frontend/src/screen-framework/widgets/registry.js', 'export function getWidgetRegistry()');
const widgetPopulation = {
  metadataFiles: review.widgetManifests.map(m => ({...m,
    incoming: graph.edges.filter(e => e.target === m.path).map(e => ({edge: e.id, file: e.from, line: e.line}))})),
  fitnessCatalog, fitnessAliases, dashboard,
  registration: at(fitnessFile, 'registry.register(key, mod.default, mod.manifest)'),
  registry: sharedRegistry,
  builtins: at('frontend/src/screen-framework/widgets/builtins.js', 'export function registerBuiltinWidgets()'),
  repeatedWeeklyReview: at('frontend/src/modules/WeeklyReview/index.js', "registry.register('weekly-review', WeeklyReview)"),
  startup: at('frontend/src/Apps/FitnessApp.jsx', "import '../modules/Fitness/index.js'"),
  lifetime: 'Fitness module import registers 14 metadata widgets plus ten dashboard components into the default screen singleton; no unregister/dispose in that module. Legacy map is 14 aliases, not 14 extra registered widgets.',
  requiresPolicy: 'Widget metadata is not backend capability activation; current Fitness launch/navigation owns any gating. Registry registration alone does not enforce manifest.requires.',
  duplicatePolicy: 'WidgetRegistry Map.set replaces by key. WeeklyReview index and builtins both register the same weekly-review component. Surround uses the class with a separate instance.'
};
assert.equal(widgetPopulation.metadataFiles.length, 14);
const webContext = 'frontend/src/contexts/WebSocketContext.jsx';
const ws = 'frontend/src/services/WebSocketService.js';
const gratitude = 'frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx';
const seams = [
  {id: 'LIFE-GR-PAYLOAD', start: at(gratitude, 'registerPayloadCallback(handleWebSocketPayload)'),
    stop: at(gratitude, 'return () => unregisterPayloadCallback()'),
    behavior: 'Effect replaces the provider single callback slot; cleanup clears the slot. It is not a new independent websocket connection or a multi-listener API.',
    cases: ['CASE-GR-UI-CLEANUP', 'CASE-GR-UI-HOMEBOT', 'CASE-GR-UI-EXTERNAL']},
  {id: 'LIFE-GR-KEYS', start: at(gratitude, "container.addEventListener('keydown', handleKeyDown)"),
    stop: at(gratitude, "container.removeEventListener('keydown', handleKeyDown)"),
    behavior: 'Effect-scoped listener follows handleKeyDown identity; second long-press effect owns three additional keydown/keyup/blur listeners and its own timer.'},
  {id: 'LIFE-GR-LONGPRESS', start: at(gratitude, 'longPressTimerRef.current = setTimeout'),
    stop: at(gratitude, "container.removeEventListener('keydown', handleLongPressStart)"),
    behavior: 'Cleared on short release, blur, replacement or cleanup; repeat/orphan/cooldown guards remain. Other action animation timers are not this timer.',
    cases: ['CASE-GR-UI-LONGPRESS', 'CASE-GR-UI-ORPHAN']},
  {id: 'LIFE-GR-INFLIGHT', start: at(gratitude, 'setTimeout(async () => {'), stop: null,
    behavior: 'Delayed selection action is not cancelled by unmount in current source; the existing test observes one persisted write. Do not promise cancellation as part of relocation.',
    cases: ['CASE-GR-UI-INFLIGHT']},
  {id: 'LIFE-WS-CONTEXT', start: at(webContext, 'const unsubscribeStatus = wsService.onStatusChange'),
    stop: at(webContext, 'unsubscribeStatus();'),
    behavior: 'Provider subscribes to status and OFFICE_TOPICS; cleanup calls both returned unsubscribers. The 300ms message-indicator timer is not cancelled here. Releasing subscribers does not disconnect the singleton.'},
  {id: 'LIFE-WS-SERVICE', start: at(ws, 'subscribe(filter, callback)'), stop: at(ws, 'this.subscribers.delete(key)'),
    behavior: 'First subscriber can auto-connect; unsubscribe updates subscription interests but does not close transport. Instance owns reconnect, stale check and degraded reload timers. disconnect does not remove onclose reconnect behavior or clear every timer; teardown redesign requires separate characterization.'},
  {id: 'LIFE-PROVIDER-RELOAD', start: at(integration + 'IntegrationLoader.mjs', 'async loadForHousehold'), stop: null,
    behavior: 'Each load constructs selected adapters and replaces the household wrapper; no disposal of previous adapter instances is performed in this method.', cases: ['CASE-PROVIDER-LOAD']}
];
const affected = new Set([...owners.moves.map(m => m.old), ...owners.foundation.map(f => f.path)]);
const affectedCalls = review.lifecycleCalls.filter(c => affected.has(c.path));
const compositionCalls = review.lifecycleCalls.filter(c => c.path === 'backend/src/app.mjs'
  || c.path === 'backend/src/5_composition/bootstrap.mjs');
emit('provider-lifecycle-review.json', {schema: 'daylight.preimplementation.provider-lifecycle-review/v1',
  baseline: review.baseline, providerManifests, collisions, widgetPopulation, seams, affectedCalls, compositionCalls,
  sourceReferences: {discovery, importOwner, registry, instantiate, config, initialized, bots, routedAdapters, configuredKeys},
  policyNotes: [
    'File enumeration is in system, but FileModuleManifestDiscovery.load also executes discovered modules there; naming it discovery does not separate upward loading responsibility.',
    'Provider indexing, config-driven household construction, system bot factory injection and explicit content registry registration are separate mechanisms.',
    'SystemBotLoader lives in composition despite comments calling it system-layer; classify source responsibility, not stale prose.',
    'No new exception to layers-of-abstraction or direct-filesystem policy is granted by this inventory.'
  ],
  sourceAccountingFollowup: {artifact:'lifecycle-closure.json', narrative:'lifecycle-closure.md',
    sections:['policies/affectedCalls: foundation logging, request/stream, fonts and unsaved guards',
      'lifetimes/shutdownBindings/scheduleBindings: actual factory and callback source',
      'cli: parser, argv and switch dispatch contributions with stable paths and incoming consumers']},
  inputs:[...inputs.values()], inventoryInputs:['registration-review.json','owner-boundaries.json','dependency-ledger.json'].map(name => ({name, sha256:hash(fs.readFileSync(path.join(packet,name)))})),
  toolHash:hash(fs.readFileSync(new URL(import.meta.url))),
  limitations:['Provider/widget portion of PRE-2.2.3; supplementary lifecycle source accounting is a separate artifact, not activation/teardown certification. No real providers or websocket singleton were started.',
    'Backend manifest enumeration reflects tracked baseline; effective deployed ignored/generated inputs remain separate provenance work.']
});
process.stdout.write(JSON.stringify({providerManifests:providerManifests.length, providerCollisions:collisions.length,
  widgetMetadata:widgetPopulation.metadataFiles.length, fitnessRegistrations:24, affectedLifecycleCalls:affectedCalls.length,
  reviewedSeams:seams.length, followup:'lifecycle-closure.json'})+'\n');
