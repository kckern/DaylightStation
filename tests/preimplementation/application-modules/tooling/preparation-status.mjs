/** Cheap, read-only resume report over the existing authoritative preparation ledgers. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, packet } from './census.mjs';
const read = name => JSON.parse(fs.readFileSync(path.join(packet, name)));
const status = read('task-status.json'), audit = read('packet-audit.json'), evidence = read('evidence-index.json');
const requested = process.argv[2];
if (process.argv.length > 3 || requested && !status.items.some(t => t.id === requested)) throw new Error('Use an existing PRE task ID or no argument');
const leaves = status.items.filter(t => !status.items.some(other => other.id.startsWith(t.id + '.')));
const count = items => ({ complete: items.filter(t => t.status === 'complete').length, total: items.length });
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
const gitLines = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split('\n').filter(Boolean);
const allowed = f => f === 'docs/_wip/plans/2026-09-05-application-module-preimplementation-plan.md'
  || f.startsWith('docs/_wip/audits/2026-09-05-application-module-preimplementation/')
  || f.startsWith('tests/preimplementation/application-modules/');
const indexed = new Set(evidence.history.map(r => path.basename(r.file)));
const unindexed = fs.readdirSync(path.join(packet, 'evidence')).filter(f => f.endsWith('.json') && !indexed.has(f)).sort().reverse();
const recent = [...evidence.history].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 3);
const open = requested ? status.items.filter(t => t.id === requested) : leaves.filter(t => t.status !== 'complete').slice(0, 3);
process.stdout.write(JSON.stringify({
  branch, worktree: root,
  checklist: { leaves: count(leaves), withRollups: count(status.items), interpretation: 'Counts only; no effort percentage inferred' },
  lastAudit: { capturedAt: audit.capturedAt, problems: audit.problems, protectedFiles: audit.protectedFiles },
  currentGitScope: { changedEntries: gitLines.length, outsidePreparation: gitLines.filter(line => !allowed(line.slice(3))) },
  recentEvidence: recent.map(r => ({ file: r.file, pack: r.pack, exitCode: r.exitCode, freshAtLastAudit: r.fresh })),
  unindexedEvidence: { total: unindexed.length, newest: unindexed.slice(0, 3) },
  nextTasks: open.map(t => ({ id: t.id, title: t.title, status: t.status, prerequisites: t.prerequisiteIds,
    evidence: t.evidenceIds.slice(0, 4), remaining: t.blockers.slice(0, 2).map(b => ({ kind: b.kind,
      nextActionExcerpt: b.nextAction?.length > 360 ? '…' + b.nextAction.slice(-360) : b.nextAction,
      fullDetails: 'task-status.json item ' + t.id })) })),
  freshness: 'Read-only summary. Last audit is historical; this command does not rehash source or run tests.',
}, null, 2) + '\n');
