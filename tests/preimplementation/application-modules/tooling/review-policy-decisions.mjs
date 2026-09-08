/** Verify every identified policy conflict has a decision, owner and blocked future card. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {root, packet, emit} from './census.mjs';

const read = name => fs.readFileSync(path.join(packet, name), 'utf8');
const decisions = read('decisions.md');
const prerequisites = read('prerequisites.md');
const backlog = read('implementation-backlog.md');
const policy = JSON.parse(read('policy-reference-review.json'));
const contracts = JSON.parse(read('contract-consumption-review.json'));
const entries = [
  {conflict: 'Unknown books rank, equal-rank checker allowance and stale hierarchy table', decision: 'DEC-POLICY-RANKS', owner: 'Architecture maintainer', cards: ['IMP-BASE.02', 'IMP-POLICY.01', 'IMP-POLICY.02'], d10: 'No D10 exception is proposed.'},
  {conflict: 'Household naming data is co-located with executable lookup/enumeration helpers', decision: 'DEC-CONTRACT-SYMBOL-SPLIT', owner: 'Architecture/system-config/test reviewers', cards: ['IMP-BASE.04'], d10: 'No filesystem capability or D10 exception is exported.'},
  {conflict: 'New package roots and public facades evade path-only layer and direct-fs gates', decision: 'DEC-POLICY-RANKS', owner: 'Tooling lead / architecture maintainer', cards: ['IMP-BASE.02'], d10: 'IMP-BASE.02 explicitly extends the separate direct-fs gate to new owner roots.'},
  {conflict: 'Player/School and browser logging/realtime SCCs could be misclassified as generic platform exports', decision: 'DEC-CYCLES', owner: 'Architecture reviewer', cards: ['IMP-SHARED.04'], d10: 'Cycle treatment does not create a filesystem exception.'}
];
for (const entry of entries) {
  assert.ok(decisions.includes('## ' + entry.decision), 'Decision missing: ' + entry.decision);
  assert.ok(prerequisites.includes('| ' + entry.decision + ' |'), 'Prerequisite row missing: ' + entry.decision);
  for (const card of entry.cards) assert.ok(backlog.includes('## ' + card), 'Blocked card missing: ' + card);
}
assert.equal(policy.rulings[0].id, 'DEC-POLICY-RANKS');
assert.equal(contracts.implementationGate.card, 'IMP-BASE.04');
assert.ok(!entries.some(entry => /exception/i.test(entry.d10) && !/No D10 exception|No filesystem capability|extends the separate direct-fs gate|does not create/.test(entry.d10)));
emit('policy-decision-review.json', {
  schema: 'daylight.preimplementation.policy-decision-review/v1',
  entries,
  sourceInputs: ['policy-reference-review.json', 'contract-consumption-review.json', 'dependency-cycle-review.json', 'decisions.md', 'prerequisites.md', 'implementation-backlog.md'],
  invariant: 'No conflict record grants a D10/direct-filesystem exception or changes reference/checker source during preparation.',
  limits: ['Accountable roles identify required future review; they are not claimed approvals.', 'Future card existence does not make its implementation, source move, checker update or documentation repair complete.']
});
process.stdout.write(JSON.stringify({conflicts: entries.length, output: 'policy-decision-review.json'}) + '\n');
