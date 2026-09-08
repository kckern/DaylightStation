/** Audit future implementation-card completeness without authorizing any card. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, emit } from './census.mjs';

const packet = 'docs/_wip/audits/2026-09-05-application-module-preimplementation';
const files = [packet + '/implementation-backlog.md', packet + '/gratitude-rehearsal.md', 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md'];
const [backlog, rehearsal, plan] = files.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
const cardSources = [
  { name: 'implementation-backlog.md', text: backlog },
  { name: 'gratitude-rehearsal.md', text: rehearsal }
];
const cards = cardSources.flatMap(({ name, text }) => {
  const matches = [...text.matchAll(/^## (IMP-[A-Z0-9-]+\.[0-9]+) — ([^\n]+)/gm)];
  return matches.map((match, index) => ({
    id: match[1],
    title: match[2],
    source: name,
    body: text.slice(match.index, matches[index + 1]?.index || text.length)
  }));
});
const fieldRules = {
  roles: /Responsible\/reviewer:/,
  prerequisites: /Prerequisites:/,
  changeType: /Type:/,
  files: /(Exact files:|Exact known files:|Edit only|Known targets:|File allowlist:)/,
  subtasks: /\n1\. \[ \]/,
  exitCriteria: /Exit:/,
  verification: /(CASE-|RUN-|Before-change|After-change|baseline)/,
  rollback: /(Rollback|Revert|revers)/i,
  stop: /(stop|block|escalat)/i,
  completion: new RegExp('- \\[ \\] ')
};
const rows = cards.map(card => ({ id: card.id, title: card.title, checks: Object.fromEntries(Object.entries(fieldRules).map(([name, rule]) => [name, rule.test(card.body)])) }));
const checks = {
  appendixCExists: plan.includes('## Appendix C — Required future implementation task card'),
  cardsDiscovered: cards.length >= 12,
  uniqueCardIds: new Set(cards.map(card => card.id)).size === cards.length,
  noCardClaimsAuthorization: cards.every(card =>
    card.source === 'gratitude-rehearsal.md'
      ? rehearsal.includes('not ready to execute')
      : /not authorized|design-blocked|ready for review/i.test(card.body)
  ),
  fieldGapsAreExplicit: rows.every(row => Object.values(row.checks).some(value => !value) || Object.values(row.checks).every(Boolean))
};
emit('task-card-review.json', {
  schema: 'daylight.preimplementation.task-card-review/v1',
  inputs: files.map(name => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') })),
  cards: rows, checks,
  completeCards: rows.filter(row => Object.values(row.checks).every(Boolean)).map(row => row.id),
  incompleteCards: rows.filter(row => Object.values(row.checks).some(value => !value)).map(row => ({ id: row.id, missing: Object.entries(row.checks).filter(([, value]) => !value).map(([name]) => name) })),
  result: Object.values(checks).every(Boolean) ? 'audit-complete' : 'audit-failed',
  limitation: 'This identifies prose/card-field gaps. It neither grants approval nor converts a design-blocked card into an executable implementation task.',
  toolHash: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')
});
process.stdout.write(JSON.stringify({ checks, cards: cards.length, completeCards: rows.filter(row => Object.values(row.checks).every(Boolean)).length }) + '\n');
