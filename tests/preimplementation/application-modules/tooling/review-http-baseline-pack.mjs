/** Reconcile Appendix A contracts to the safe router/composition baseline pack. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const packet = 'docs/_wip/audits/2026-09-05-application-module-preimplementation';
const contractsPath = packet + '/contracts.json';
const routePath = packet + '/gratitude-route-seed-review.json';
const casePath = 'tests/preimplementation/application-modules/cases/gratitude.case.mjs';
const driverPath = 'tests/preimplementation/application-modules/drivers/gratitude.mjs';
const contracts = JSON.parse(fs.readFileSync(path.join(root, contractsPath), 'utf8'));
const routeReview = JSON.parse(fs.readFileSync(path.join(root, routePath), 'utf8'));
const casesById = new Map(contracts.cases.map(item => [item.id, item]));
const families = contracts.contracts.filter(item => /^CTR-GR-HTTP-/.test(item.id));
const cases = families.flatMap(family => (family.caseIds || []).map(id => casesById.get(id) || { id, missing: true }));
const caseSource = fs.readFileSync(path.join(root, casePath), 'utf8');
const driverSource = fs.readFileSync(path.join(root, driverPath), 'utf8');
const checks = {
  allAppendixARoutesMapped: families.length === 18 && routeReview.summary.routes === 18 && routeReview.rows.length === 18 && families.every(family => routeReview.rows.some(row => row.id === family.id)),
  everyContractCaseResolves: cases.length === 22 && cases.every(item => !item.missing && item.source === casePath && item.runner === 'node:test' && item.oracle?.expected?.length),
  namedContractCasesRemainInSource: cases.every(item => caseSource.includes(item.id) || (item.id.startsWith('CASE-GR-HTTP-18-') && caseSource.includes("test('CASE-GR-HTTP-18-' + name"))),
  realRouterTranslationUsed: driverSource.includes('createGratitudeRouter') && driverSource.includes('createApiRouter') && driverSource.includes('errorHandlerMiddleware') && driverSource.includes("outer.use('/api/v1', api)"),
  safeWireSerializationUsed: caseSource.includes('dispatchWireRequest') && caseSource.includes('new Duplex') === false,
  mountProjectionBounded: caseSource.includes("This is the observed middleware arrangement's projection, not importing app.mjs.") && routeReview.rows.every(row => row.composedMount?.path === 'backend/src/app.mjs' && row.parents?.[0]?.path === 'backend/src/4_api/v1/routers/api.mjs'),
  fullAssemblyExplicitlyExcluded: driverSource.includes('Unsafe fixture environment') && !driverSource.includes("from '../../../../backend/src/app.mjs'")
};
emit('http-baseline-pack-review.json', {
  schema: 'daylight.preimplementation.http-baseline-pack-review/v1',
  inputs: [contractsPath, routePath, casePath, driverPath].map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })),
  contracts: families.map(family => ({ id: family.id, caseIds: family.caseIds, route: routeReview.rows.find(row => row.id === family.id)?.fullPattern })),
  checks, result: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
  blockedCoverage: 'The real app.mjs mount and its device/network/token/global middleware are source-inventoried in gratitude-route-seed-review.json, but are intentionally not imported by this safe pack. Full controller assembly remains a separate blocked coverage item.',
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify({ checks, contracts: families.length, cases: cases.length }) + '\n');
