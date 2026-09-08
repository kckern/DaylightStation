/** Reconcile Appendix B data families to concrete, real-baseline characterization cases. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const packet = 'docs/_wip/audits/2026-09-05-application-module-preimplementation';
const contractsPath = path.join(root, packet, 'contracts.json');
const contracts = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
const ids = ['CTR-GR-DATA-01', 'CTR-GR-DATA-02', 'CTR-GR-DATA-03'];
const caseById = new Map(contracts.cases.map(item => [item.id, item]));
const families = ids.map(id => {
  const contract = contracts.contracts.find(item => item.id === id);
  const cases = (contract?.caseIds || []).map(caseId => caseById.get(caseId)).filter(Boolean);
  return {
    id, requiredBehavior: contract?.requiredBehavior, caseIds: contract?.caseIds || [],
    cases: cases.map(item => ({ id: item.id, description: item.description, source: item.source, runner: item.runner, baselineResult: item.baselineResult, oracleKind: item.oracle?.kind, oracleAssertions: item.oracle?.expected?.length || 0 })),
    unresolvedCaseIds: (contract?.caseIds || []).filter(caseId => !caseById.has(caseId))
  };
});
const sourcePaths = [...new Set(families.flatMap(family => family.cases.map(item => item.source)))];
const source = Object.fromEntries(sourcePaths.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
const driverPath = 'tests/preimplementation/application-modules/drivers/gratitude.mjs';
const driver = fs.readFileSync(path.join(root, driverPath), 'utf8');
const caseTextPresent = families.every(family => family.cases.every(item => {
  const originalTitle = item.description.replace(/^gratitude stored YAML shape \(characterization\) /, '');
  return source[item.source].includes(item.id) || source[item.source].includes(item.description) || source[item.source].includes(originalTitle);
}));
const gratitudeSource = source['tests/preimplementation/application-modules/cases/gratitude.case.mjs'] || '';
const checks = {
  appendixBFamiliesPresent: families.length === 3 && families.every(family => family.requiredBehavior && family.caseIds.length),
  everyDeclaredCaseResolves: families.every(family => !family.unresolvedCaseIds.length && family.cases.length === family.caseIds.length),
  everyCaseHasRunnableSourceAndOracle: families.every(family => family.cases.every(item => ['node:test', 'vitest'].includes(item.runner) && ['source-assertion-projection', 'reused-or-planned-case'].includes(item.oracleKind) && (item.oracleAssertions > 0 || item.oracleKind === 'reused-or-planned-case'))),
  namedCasesRemainInSources: caseTextPresent,
  realBaselineStorageTypesUsed: ['DataService', 'ConfigService', 'YamlGratitudeDatastore', 'GratitudeService'].every(name => gratitudeSource.includes(name)),
  syntheticRootGuarded: driver.includes('PRE_RUN_ROOT') && driver.includes('Unsafe fixture environment'),
  noCandidateResultClaimed: families.every(family => family.cases.every(item => item.baselineResult === 'passed')) && contracts.cases.filter(item => families.some(family => family.caseIds.includes(item.id))).every(item => item.candidateResult === 'candidate-pending')
};
emit('storage-baseline-pack-review.json', {
  schema: 'daylight.preimplementation.storage-baseline-pack-review/v1',
  inputs: [packet + '/contracts.json', ...sourcePaths, driverPath].map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })),
  families, checks, result: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
  limitation: 'This reconciles executable source and historical green receipts. Fresh isolated execution remains required when the OS sandbox is available; it does not claim candidate or runtime persistence parity.',
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify({ checks, families: families.map(family => ({ id: family.id, cases: family.cases.length })) }) + '\n');
