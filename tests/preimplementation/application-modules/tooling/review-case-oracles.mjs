/** Verify that each catalogued case carries a source-derived, bounded oracle. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packet, emit} from './census.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const catalogPath = path.join(packet, 'contracts.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath));
const required = ['kind', 'expected', 'observableFacets', 'ordering', 'deterministicControls', 'permittedNormalization'];
const issues = catalog.cases.map(caseRecord => {
  const oracle = caseRecord.oracle || {};
  const missing = required.filter(field => !oracle[field] || Array.isArray(oracle[field]) && !oracle[field].length);
  if (oracle.permittedNormalization !== caseRecord.normalization) missing.push('permittedNormalization must equal case normalization');
  if (oracle.kind === 'source-assertion-projection' && oracle.expected.some(expected => !expected.startsWith('assert.')))
    missing.push('source assertion projection contains non-assertion expectation');
  if (caseRecord.baselineResult.startsWith('not-run') && !caseRecord.id.match(/^CASE-(?:GR-RECOVERY|BUILD)-/))
    missing.push('not-run is permitted only for explicit Recovery/Build planned cases');
  return {id: caseRecord.id, missing};
}).filter(issue => issue.missing.length);
const caseIds = new Set(catalog.cases.map(item => item.id));
const contractIssues = catalog.contracts.map(contract => ({
  id: contract.id,
  unresolved: contract.caseIds.filter(id => !caseIds.has(id))
})).filter(issue => issue.unresolved.length);
const byKind = Object.fromEntries([...new Set(catalog.cases.map(item => item.oracle.kind))]
  .map(kind => [kind, catalog.cases.filter(item => item.oracle.kind === kind).length]));
const facetCounts = Object.fromEntries([...new Set(catalog.cases.flatMap(item => item.oracle.observableFacets))]
  .sort().map(facet => [facet, catalog.cases.filter(item => item.oracle.observableFacets.includes(facet)).length]));
emit('case-oracle-review.json', {
  schema: 'daylight.preimplementation.case-oracle-review/v1',
  inventoryInputs: [{name: 'contracts.json', sha256: hash(fs.readFileSync(catalogPath))}],
  required,
  summary: {
    cases: catalog.cases.length,
    contracts: catalog.contracts.length,
    byKind,
    facetCounts,
    passed: !issues.length && !contractIssues.length
  },
  issues,
  contractIssues,
  limits: [
    'A source-derived oracle documents existing assertions; it does not itself execute a candidate.',
    'Recovery/Build planned cases remain not-run until their isolated candidate/build driver exists.',
    'This review does not replace the HTTP, storage, rendering, browser, or consumer family expansion tasks.'
  ],
  toolHash: hash(fs.readFileSync(new URL(import.meta.url)))
});
process.stdout.write(JSON.stringify({cases: catalog.cases.length, contracts: catalog.contracts.length, issues: issues.length, contractIssues: contractIssues.length, byKind}) + '\n');
