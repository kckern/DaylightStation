/**
 * repair-open-challenges — saved sessions whose challenge never resolved
 * (result 'started', no end: open when the session ended, before the
 * session-end close existed) become 'abandoned', the same outcome a session
 * now records itself. Dry-run unless --apply.
 */
import path from 'path';
import { readdirSync } from 'fs';
import moment from 'moment-timezone';
import { parseArgs, bool, num } from './argv.mjs';

export const spec = {
  name: 'repair-open-challenges',
  summary: "mark saved challenges that never resolved as 'abandoned'",
  usage: 'fitness session repair-open-challenges [--days 365] [--apply]',
  details: "Challenges saved as result 'started' with no end are rewritten to result 'abandoned' (reason 'unresolved_at_save'). Dry-run unless --apply.",
};

export function closeOpenChallengeRecords(session) {
  const events = session?.timeline?.events;
  if (!Array.isArray(events)) return 0;
  let changed = 0;
  for (const e of events) {
    if (e?.type !== 'challenge' || !e.data) continue;
    const open = (e.data.result == null || e.data.result === 'started') && !Number.isFinite(e.data.end);
    if (!open) continue;
    e.data.result = 'abandoned';
    e.data.reason = 'unresolved_at_save';
    changed++;
  }
  return changed;
}

export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['apply'] });
  const apply = bool(flags, 'apply');
  const days = num(flags, 'days', 365);
  const root = ctx.fitnessHistoryDir;
  const cutoff = moment().subtract(days, 'days').format('YYYY-MM-DD');
  console.log(`Repair open challenges (${days} days back, cutoff ${cutoff}) — ${apply ? 'APPLY' : 'DRY-RUN'}\n`);
  const tally = { scanned: 0, sessions: 0, challenges: 0 };
  const dayDirs = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff).sort();
  for (const day of dayDirs) {
    for (const file of readdirSync(path.join(root, day)).filter((f) => f.endsWith('.yml') && !f.includes('conflicted copy'))) {
      const full = path.join(root, day, file);
      const session = ctx.loadYamlSafe(full);
      if (!session) continue;
      tally.scanned++;
      const n = closeOpenChallengeRecords(session);
      if (!n) continue;
      tally.sessions++;
      tally.challenges += n;
      console.log(`  ${day}/${file}  ${n} open challenge(s)`);
      if (apply) ctx.saveYaml(full, session);
    }
  }
  console.log(`\n  Scanned ${tally.scanned}; ${tally.challenges} challenge(s) in ${tally.sessions} session(s) ${apply ? 'repaired' : 'would be repaired'}`);
  return { ...tally, apply };
}
