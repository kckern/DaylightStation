/** Fail closed on the catalog fields required before migration case design. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packet, root, emit} from './census.mjs';

const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contracts = read('contracts.json');
const planPath = 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md';
const plan = fs.readFileSync(path.join(root, planPath), 'utf8');
const publicEntries = read('public-entry-review.json');
const fields = [
  'owner', 'source', 'consumer', 'preconditions', 'input', 'observableOutput',
  'effectsAndCleanup', 'expectedErrors', 'evidenceBasis', 'criticality', 'caseIds'
];
const value = (contract, field) => field === 'input'
  ? contract.inputAndOracle || contract.inputOracle
  : contract[field];
const missing = contracts.contracts.map(contract => ({
  id: contract.id,
  missing: fields.filter(field => {
    const item = value(contract, field);
    return item === undefined || item === null || item === '' || Array.isArray(item) && item.length === 0;
  }),
  unknownCases: (contract.caseIds || []).filter(id => !contracts.cases.some(item => item.id === id))
})).filter(item => item.missing.length || item.unknownCases.length);
const appendixA = plan.split('## Appendix A')[1]?.split('## Appendix B')[0] || '';
const appendixB = plan.split('## Appendix B')[1]?.split('## Appendix C')[0] || '';
const plannedIds = [...(appendixA + appendixB).matchAll(/^\| (CTR-[A-Z0-9-]+) \|/gm)].map(match => match[1]);
const catalogIds = new Set(contracts.contracts.map(contract => contract.id));
const missingPlanContracts = plannedIds.filter(id => !catalogIds.has(id));
const publicContracts = new Set(publicEntries.entries.flatMap(entry => entry.contractIds));
const publicWithoutCatalog = [...publicContracts].filter(id => !catalogIds.has(id));
const caseIssues = contracts.cases.map(item => ({
  id: item.id,
  missing: ['description', 'runner', 'source', 'baselineResult', 'evidence', 'expectationBasis', 'normalization', 'oracle']
    .filter(field => !item[field])
})).filter(item => item.missing.length);
emit('contract-catalog-review.json', {
  schema: 'daylight.preimplementation.contract-catalog-review/v1',
  inputs: [{name: planPath, sha256: hash(fs.readFileSync(path.join(root, planPath)))}],
  inventoryInputs: [
    {name: 'contracts.json', sha256: hash(fs.readFileSync(path.join(packet, 'contracts.json')))},
    {name: 'public-entry-review.json', sha256: hash(fs.readFileSync(path.join(packet, 'public-entry-review.json')))}
  ],
  requiredContractFields: fields,
  summary: {
    contractFamilies: contracts.contracts.length,
    caseRecords: contracts.cases.length,
    planFamilies: plannedIds.length,
    completeRecords: contracts.contracts.length - missing.length,
    incompleteRecords: missing.length,
    recordsReady: !missing.length && !missingPlanContracts.length && !publicWithoutCatalog.length && !caseIssues.length
  },
  incompleteRecords: missing,
  missingPlanContracts,
  publicWithoutCatalog,
  caseIssues,
  limits: [
    'This verifies catalog record completeness and linkage, not whether every per-case oracle is executable.',
    'A candidate-pending case may be catalogued but does not count as a baseline pass.',
    'Appendix family presence does not authorize a new behavior or fill a missing oracle.'
  ],
  toolHash: hash(fs.readFileSync(new URL(import.meta.url)))
});
process.stdout.write(JSON.stringify({
  contracts: contracts.contracts.length,
  cases: contracts.cases.length,
  completeRecords: contracts.contracts.length - missing.length,
  incompleteRecords: missing.length,
  missingPlanContracts: missingPlanContracts.length,
  publicWithoutCatalog: publicWithoutCatalog.length,
  caseIssues: caseIssues.length
}) + '\n');
