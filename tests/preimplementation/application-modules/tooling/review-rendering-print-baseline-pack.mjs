/** Keep renderer/native evidence separate from fake-printer delivery evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const packet = 'docs/_wip/audits/2026-09-05-application-module-preimplementation';
const contractsPath = packet + '/contracts.json';
const renderingBoundaryPath = packet + '/rendering-boundary.json';
const sources = [
  'tests/preimplementation/application-modules/cases/rendering.case.mjs',
  'tests/preimplementation/application-modules/cases/gratitude.case.mjs',
  'tests/preimplementation/application-modules/cases/registrations.case.mjs',
  'tests/preimplementation/application-modules/drivers/gratitude.mjs',
  'tests/preimplementation/application-modules/README.md'
];
const contracts = JSON.parse(fs.readFileSync(path.join(root, contractsPath), 'utf8'));
const boundary = JSON.parse(fs.readFileSync(path.join(root, renderingBoundaryPath), 'utf8'));
const byId = new Map(contracts.cases.map(item => [item.id, item]));
const families = contracts.contracts.filter(item => /^CTR-GR-PRINT-/.test(item.id));
const cases = families.flatMap(family => (family.caseIds || []).map(id => byId.get(id) || { id, missing: true }));
const text = Object.fromEntries(sources.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
const rendering = text[sources[0]], gratitude = text[sources[1]], registrations = text[sources[2]], driver = text[sources[3]], readme = text[sources[4]];
const checks = {
  threeSeparatePrintFamilies: families.length === 3 && families.map(item => item.id).join(',') === 'CTR-GR-PRINT-01,CTR-GR-PRINT-02,CTR-GR-PRINT-03',
  everyContractCaseResolves: cases.length === 16 && cases.every(item => !item.missing && ['node:test', 'vitest'].includes(item.runner)),
  rendererHasNativeFontAndPixelOracles: ['CASE-GR-RENDER-NATIVE', 'CASE-GR-RENDER-FLIP', 'CASE-GR-RENDER-EMPTY'].every(id => rendering.includes(id)) && rendering.includes('createGratitudeCardRenderer') && rendering.includes('initCanvas') && rendering.includes('getImageData') && rendering.includes('backend/assets/fonts'),
  presentationIsApplicationOwned: rendering.includes('CASE-GR-PRESENTATION') && rendering.includes('GratitudePrintPresentationService') && rendering.includes('new GratitudePrintPresentationService'),
  deliveryUsesFakePrinterPort: driver.includes('printerRegistry') && driver.includes('imagePrintGateway') && gratitude.includes('CASE-GR-PRINT-NOTFOUND') && gratitude.includes('CASE-GR-PRINT-UNCONFIGURED'),
  tempGatewayHasByteAndCleanupAssertions: gratitude.includes("CASE-GR-TEMP-CLEANUP-' + fails") && registrations.includes('CASE-GR-TEMP-CONTRACT') && registrations.includes('fs.readFileSync(file),buffer'),
  nativePrerequisitesRemainExplicit: boundary.status.includes('native') && readme.includes('Installed backend canvas') && cases.every(item => item.candidateResult === 'candidate-pending')
};
emit('rendering-print-baseline-pack-review.json', {
  schema: 'daylight.preimplementation.rendering-print-baseline-pack-review/v1',
  inputs: [contractsPath, renderingBoundaryPath, ...sources].map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })),
  families: families.map(family => ({ id: family.id, caseIds: family.caseIds })), checks,
  result: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
  limitation: 'Native rendering is characterized using current installed canvas and bundled fonts; package/lock/Linux identity and a future candidate remain separate prerequisites. Printer/device effects are fake-backed only.',
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify({ checks, families: families.length, cases: cases.length }) + '\n');
