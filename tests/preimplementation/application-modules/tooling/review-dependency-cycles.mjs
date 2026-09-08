/** Classify actual SCC edges and proposed port/composition bindings; no source mutation. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {packet, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const ledger = read('dependency-ledger.json');
const owners = read('owner-boundaries.json');
const feed = read('feed-boundary.json');
const homebot = read('homebot-boundary.json');
const household = read('household-boundary.json');
assert.equal(ledger.cycles.length, 6, 'SCC population changed: recertify classification deliberately');
const cyclePolicy = [
  {id: 'SCC-UTILITY-ERRORS', owner: 'platform/system', relation: 'same-owner internal barrel cycle', disposition: 'No cross-owner boundary. Utility extraction must retain or explicitly break the three concrete edges without changing error/timestamp behavior.'},
  {id: 'SCC-SCHOOL-DOCUMENTS', owner: 'School product/domain', relation: 'same-product document helper cycle', disposition: 'Outside Gratitude move authority; retain as School-owned until a School card classifies the two concrete imports.'},
  {id: 'SCC-CHESS-CLI', owner: 'Chess CLI product', relation: 'same-command CLI cycle', disposition: 'Outside Gratitude move authority; not a platform command or package export.'},
  {id: 'SCC-BROWSER-LOGGING-REALTIME', owner: 'platform/web observability + realtime subowners', relation: 'cross-subowner runtime cycle', disposition: 'Do not split by copying Logger, transport, WebSocket service or context. Preserve the one intended browser service/logger graph and test identity before any extraction.'},
  {id: 'SCC-PLAYER-SCHOOL', owner: 'Player and School product surfaces', relation: 'cross-product experience cycle', disposition: 'Do not promote Player/AppContainer as a generic host while it imports installed School surfaces. Requires a future product-free host seam or retained product composition.'},
  {id: 'SCC-FITNESS-UI', owner: 'Fitness product UI/context', relation: 'same-product UI/context SCC', disposition: 'Outside Gratitude move authority. Retain the complete Fitness context/widget graph; no individual widget becomes platform merely because it is reusable-looking.'}
];
const cycles = ledger.cycles.map((files, index) => {
  const policy = cyclePolicy[index];
  const members = new Set(files);
  const edges = ledger.edges.filter(edge => members.has(edge.from) && members.has(edge.target)).map(edge => ({
    edgeId: edge.id, from: edge.from, line: edge.line, specifier: edge.specifier, syntax: edge.syntax, to: edge.target
  }));
  assert.ok(edges.length >= files.length, 'SCC has insufficient concrete edges: ' + policy.id);
  return {...policy, members: [...files].sort(), edges};
});
const operationBinding = operation => ({
  id: operation.id,
  kind: 'composition-returned-operation',
  owner: operation.owner,
  layer: operation.layer,
  throughEntry: operation.throughEntry,
  returnedMember: operation.returnedMember,
  binding: operation.binding,
  rule: operation.visibility,
  runtimeImports: 'The port and implementation remain owner-private. This is a proposed composition-bound function, not a new direct Feed/Homebot-to-Gratitude runtime import.'
});
const binding = {
  portContracts: [
    operationBinding(feed.operation), operationBinding(homebot.operation),
    {id: 'household-presentation', kind: 'composition-returned-capability', owner: 'household-identity', layer: household.returnedInterface.layer,
      throughEntry: '@daylight/household-identity/server/compose', returnedMember: household.returnedInterface.member,
      binding: 'Composition constructs the inert query over ConfigService and injects the returned presentation object at the current Gratitude binding point.',
      rule: household.returnedInterface.narrowSource,
      runtimeImports: 'The proposed adapter imports only its local application port. The public web client imports the existing proposed platform HTTP entry; neither creates a server-side cross-owner private import.'}
  ],
  compositionBindings: [
    {source: 'backend/src/app.mjs', targetOwner: 'gratitude + Feed', detail: feed.operation.binding},
    {source: 'backend/src/app.mjs', targetOwner: 'gratitude + Homebot', detail: homebot.operation.binding},
    {source: 'backend/src/5_composition/modules/gratitudeApi.mjs', targetOwner: 'household-identity + Gratitude', detail: 'Inject householdPresentation; retain the owner-private helper until its separately specified relocation.'}
  ],
  existingRuntimeImports: owners.foundationImpact.edges.filter(edge => /backend\/src\/(app\.mjs|5_composition\/modules\/gratitudeApi\.mjs)/.test(edge.consumer))
    .map(edge => ({edgeId: edge.edge, from: edge.consumer, line: edge.line, to: edge.target, symbols: edge.symbols}))
};
emit('dependency-cycle-review.json', {
  schema: 'daylight.preimplementation.dependency-cycle-review/v1',
  scope: 'All six static source SCCs from dependency-ledger.json plus the selected Gratitude cross-owner port/composition designs.',
  cycles,
  bindings: binding,
  violations: [
    {id: 'VIOLATION-PLAYER-HOST', status: 'open', cycle: 'SCC-PLAYER-SCHOOL', rule: 'A generic host/capability may not import product surfaces; retain the product composition or extract a product-free seam first.'},
    {id: 'VIOLATION-PLATFORM-IDENTITY', status: 'open', cycle: 'SCC-BROWSER-LOGGING-REALTIME', rule: 'A public facade cannot duplicate existing mutable/context/runtime state across subowners.'}
  ],
  limits: ['Static source SCCs are not proof of runtime call order, module-evaluation effects or deployment topology.', 'Candidate port/composition entries are design records only; no candidate source exists and no baseline runtime import is hidden or rewritten.', 'All other cycle-related product refactors remain future owner cards; this review grants no move authority.']
});
process.stdout.write(JSON.stringify({cycles: cycles.map(c => ({id: c.id, members: c.members.length, edges: c.edges.length})), portContracts: binding.portContracts.length, output: 'dependency-cycle-review.json'}) + '\n');
