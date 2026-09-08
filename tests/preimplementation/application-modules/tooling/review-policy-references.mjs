/** Compare binding layer references, current checker behavior and observed source edges. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import {root, packet, emit} from './census.mjs';

const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const locate = (text, needle) => {
  const index = text.indexOf(needle);
  assert.ok(index >= 0, 'Missing reviewed reference: ' + needle);
  return text.slice(0, index).split('\n').length;
};
const checkerPath = 'scripts/audit-layer-imports.mjs';
const checker = source(checkerPath);
const ast = parse(checker, {sourceType: 'module'});
let levelsNode;
const visit = node => {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id?.name === 'DOMAIN_LEVELS') levelsNode = node.init.arguments?.[0] || node.init;
  for (const value of Object.values(node)) Array.isArray(value) ? value.forEach(visit) : visit(value);
};
visit(ast);
assert.ok(levelsNode?.type === 'ObjectExpression', 'Unable to inspect DOMAIN_LEVELS');
const levels = Object.fromEntries(levelsNode.properties.map(property => [property.key.name || property.key.value, property.value.value]));
const domains = fs.readdirSync(path.join(root, 'backend/src/2_domains'), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const missingRanks = domains.filter(domain => !(domain in levels));
assert.deepEqual(missingRanks, ['books']);
const decision = source('docs/reference/core/layers-of-abstraction/decision-register.md');
const domainGuide = source('docs/reference/core/layers-of-abstraction/domain-layer-guidelines.md');
const systemGuide = source('docs/reference/core/layers-of-abstraction/system-layer-guidelines.md');
const configuration = source('docs/reference/core/configuration.md');
const architecture = source('docs/reference/core/backend-architecture.md');
const expectedDecisions = Object.fromEntries([...Array(10).keys()].map(index => {
  const id = 'D' + (index + 1);
  return [id, {path: 'docs/reference/core/layers-of-abstraction/decision-register.md', line: locate(decision, `| **${id}** |`)}];
}));
const actualEdges = [
  {from: 'backend/src/2_domains/piano/gameBudget.mjs', line: 19, to: '#domains/school/timing.mjs', relation: 'same-rank piano → school'},
  {from: 'backend/src/2_domains/trigger/services/BarcodeResolver.mjs', line: 9, to: '#domains/barcode/BarcodePayload.mjs', relation: 'same-rank trigger → barcode'},
  {from: 'backend/src/2_domains/trigger/services/BarcodeResolver.mjs', line: 10, to: '#domains/barcode/BarcodeCommandMap.mjs', relation: 'same-rank trigger → barcode'}
];
for (const edge of actualEdges) assert.ok(source(edge.from).split('\n')[edge.line - 1].includes(edge.to));
emit('policy-reference-review.json', {
  schema: 'daylight.preimplementation.policy-reference-review/v1',
  decisions: expectedDecisions,
  references: {
    lowerOnlyDomains: {path: 'docs/reference/core/layers-of-abstraction/domain-layer-guidelines.md', line: locate(domainGuide, 'Domains can import from lower-level domains only.')},
    domainTable: {path: 'docs/reference/core/layers-of-abstraction/domain-layer-guidelines.md', line: locate(domainGuide, 'Every domain folder in `2_domains/` is assigned a level below')},
    systemKernelException: {path: 'docs/reference/core/backend-architecture.md', line: locate(architecture, 'sole exemption: pure shared-kernel utils at #domains/core/utils')},
    systemNamingContract: {path: 'docs/reference/core/layers-of-abstraction/system-layer-guidelines.md', line: locate(systemGuide, 'That mapping is a naming contract, not')},
    configNamingContract: {path: 'docs/reference/core/configuration.md', line: locate(configuration, 'naming contract is not config internals')}
  },
  checker: {
    path: checkerPath,
    domainLevels: levels,
    physicalDomains: domains,
    missingRanks,
    currentBehavior: [
      {rule: 'unknown rank', evidence: 'scanDomainHierarchyViolations returns [] when source or target rank is undefined', outcome: 'books is silently accepted'},
      {rule: 'equal rank', evidence: 'only target level > source level is a violation', outcome: 'same-rank feature-domain edges are accepted'},
      {rule: 'D4 system kernel', evidence: 'system-no-upward expressly excludes backend/src/2_domains/core/utils', outcome: 'narrow permitted exception; not general system-to-domain access'}
    ],
    referenceDrift: ['The live domain guide says every domain folder is listed but its displayed table omits current folders such as books, automotive, camera, economy, exercise, measures, midi and shutdown.', 'The guide says lower-level only; current checker permits equal rank and silently skips unknown ranks.']
  },
  actualSourceEvidence: actualEdges,
  rulings: [
    {id: 'DEC-POLICY-RANKS', status: 'proposed, not implemented', rule: 'books Level 2; strict downward imports; unknown ranks fail closed; equal rank only declarative names/schemas/data constants through shared/contracts', blockedCards: ['IMP-BASE.02', 'IMP-POLICY.01', 'IMP-POLICY.02']},
    {id: 'DEC-CONTRACT-SYMBOL-SPLIT', status: 'selected per-symbol boundary', rule: 'HOUSEHOLD_APP_CONFIGS is declarative; appConfigRelPath/allAppNames are executable private system helpers, not contract exports', blockedCards: ['IMP-BASE.04']}
  ],
  limits: ['This records policy/checker disagreement; it does not change binding references, checker behavior or source imports.', 'D1-D10 remain binding during all proposed moves. A public facade, ownership label, contract entry or port never creates an exception.']
});
process.stdout.write(JSON.stringify({decisions: Object.keys(expectedDecisions).length, domains: domains.length, missingRanks, sourceFindings: actualEdges.length, output: 'policy-reference-review.json'}) + '\n');
