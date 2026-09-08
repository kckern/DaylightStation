/** Reconcile Appendix B browser/event/consumer contracts to actual-code, fake-port cases. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const packet = 'docs/_wip/audits/2026-09-05-application-module-preimplementation';
const contractsPath = packet + '/contracts.json';
const sources = [
  'tests/preimplementation/application-modules/cases/browser.case.mjs',
  'tests/preimplementation/application-modules/cases/gratitude.case.mjs',
  'tests/preimplementation/application-modules/cases/rendering.case.mjs',
  'tests/preimplementation/application-modules/cases/registrations.case.mjs',
  'tests/preimplementation/application-modules/drivers/browser-ports.mjs',
  'tests/preimplementation/application-modules/drivers/browser-baseline.mjs',
  'tests/preimplementation/application-modules/drivers/browser-target.mjs'
];
const contracts = JSON.parse(fs.readFileSync(path.join(root, contractsPath), 'utf8'));
const byId = new Map(contracts.cases.map(item => [item.id, item]));
const families = contracts.contracts.filter(item => /^(CTR-GR-UI-|CTR-GR-EVENT-|CTR-GR-CONSUMER-)/.test(item.id));
const cases = families.flatMap(family => (family.caseIds || []).map(id => byId.get(id) || { id, missing: true }));
const text = Object.fromEntries(sources.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
const browser = text[sources[0]], ports = text[sources[4]], baseline = text[sources[5]], target = text[sources[6]];
const caseSource = Object.fromEntries(sources.slice(0, 4).map(name => [name, text[name]]));
const namedInSource = item => Object.values(caseSource).some(source => source.includes(item.id) || (item.id.startsWith('CASE-GR-FEED-NONARRAY-') && source.includes("'CASE-GR-FEED-NONARRAY-' + label")) || (item.id.startsWith('CASE-GR-HTTP-18-') && source.includes("'CASE-GR-HTTP-18-' + name")));
const checks = {
  allAppendixBConsumerFamiliesPresent: families.length === 7 && ['CTR-GR-UI-01', 'CTR-GR-UI-02', 'CTR-GR-EVENT-01', 'CTR-GR-CONSUMER-01', 'CTR-GR-CONSUMER-02', 'CTR-GR-CONSUMER-03', 'CTR-GR-CONSUMER-04'].every(id => families.some(family => family.id === id)),
  everyDeclaredCaseResolves: cases.length === 51 && cases.every(item => !item.missing && ['node:test', 'vitest'].includes(item.runner) && item.source && item.oracle),
  namedCasesRemainInDedicatedOrExistingSource: cases.every(namedInSource),
  browserUsesActualComponentsThroughTarget: browser.includes('await loadBrowserImplementation()') && baseline.includes('frontend/src/modules/AppContainer/Apps/Gratitude/Gratitude.jsx') && target.includes('CANDIDATE_DRIVER_SHAPE_INVALID'),
  browserPortsAreSyntheticOnly: ports.includes('Synthetic logging and WebSocket transport only') && ports.includes('subscribe') && ports.includes('onStatusChange') && browser.includes('globalThis.fetch = async'),
  lifecycleCleanupIsAsserted: browser.includes('CASE-GR-UI-CLEANUP') && browser.includes('subscriptions()') && browser.includes('CASE-GR-UI-INFLIGHT'),
  noCandidateOrPrivateServiceClaim: cases.every(item => item.candidateResult === 'candidate-pending') && !ports.includes('backend/src/')
};
emit('browser-consumer-baseline-pack-review.json', {
  schema: 'daylight.preimplementation.browser-consumer-baseline-pack-review/v1',
  inputs: [contractsPath, ...sources].map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })),
  families: families.map(family => ({ id: family.id, caseIds: family.caseIds })), checks,
  result: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
  limitation: 'JSDOM/fake fetch/WebSocket validates component and adapter behavior only. It does not prove browser bundle, device, live WebSocket, household controller, or candidate public-entry behavior.',
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify({ checks, families: families.length, cases: cases.length }) + '\n');
