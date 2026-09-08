/** Apply reviewed receipts to progress only; never infer completion from counts. */
import fs from 'node:fs';
import path from 'node:path';
import { root, packet, emit } from './census.mjs';
const status = JSON.parse(fs.readFileSync(path.join(packet, 'task-status.json')));
const receipts = JSON.parse(fs.readFileSync(path.join(packet, 'reviewed-exits.json')));
const byId = new Map(status.items.map(item => [item.id, item]));
const dependencies = {
  1: [],
  2: ['PRE-1'],
  3: ['PRE-2'],
  4: ['PRE-3'],
  5: ['PRE-2', 'PRE-3'],
  6: ['PRE-1', 'PRE-5'],
  7: ['PRE-3', 'PRE-4', 'PRE-6'],
  8: ['PRE-2', 'PRE-3', 'PRE-4', 'PRE-5', 'PRE-6', 'PRE-7'],
  9: ['PRE-4', 'PRE-5', 'PRE-8'],
  10: ['PRE-9']
};
for (const item of status.items) item.prerequisiteIds = dependencies[Number(item.id.split('-')[1].split('.')[0])];
for (const receipt of receipts.items) {
  const item = byId.get(receipt.id);
  if (!item || !receipt.review || !receipt.evidence?.length) throw new Error('Invalid receipt ' + receipt.id);
  for (const evidence of receipt.evidence) if (!fs.existsSync(path.resolve(packet, evidence.split('#')[0]))) throw new Error('Missing evidence ' + evidence);
  Object.assign(item, {
    status: receipt.status,
    evidenceIds: receipt.evidence,
    decisionIds: receipt.decisions || [],
    blockers: receipt.blockers || [],
    review: receipt.review,
    completedAt: receipt.status === 'complete' ? receipt.reviewedAt : null
  });
}
for (const item of status.items.filter(i => i.status === 'complete')) {
  for (const child of status.items.filter(i => i.id.startsWith(item.id + '.'))) if (child.status !== 'complete') throw new Error('Incomplete child ' + child.id + ' of ' + item.id);
  for (const dep of item.prerequisiteIds) if (byId.get(dep)?.status !== 'complete') throw new Error('Incomplete prerequisite ' + dep + ' of ' + item.id);
}
const plan = path.join(root, 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md');
let text = fs.readFileSync(plan, 'utf8');
text = text.replace(/^- \[[ x]\] (\*\*(PRE-[\d.]+) —)/gm, (_, prefix, id) => '- [' + (byId.get(id)?.status === 'complete' ? 'x' : ' ') + '] ' + prefix);
fs.writeFileSync(plan, text);
emit('task-status.json', status);
const counts = {};
for (const item of status.items) counts[item.status] = (counts[item.status] || 0) + 1;
process.stdout.write(JSON.stringify(counts) + '\n');
