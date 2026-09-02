/**
 * Restore a session window that a resume rebased to the reload moment.
 *
 * `_hydrateFromSession` used to read only a numeric `startTime`, which a v3
 * record does not carry (`dehydrateSessionRecord` writes it for pre-v3 only), so
 * every v3 resume fell through to `now`. The session's own start was rewritten
 * to the instant of the reload while its media events — which carry absolute
 * timestamps — kept the real span. Session 20260901154746 ended up claiming a
 * 20-minute window over a 94-minute workout.
 *
 * THE CORROBORATION THAT MAKES THIS SAFE: a session id IS its start time
 * (`YYYYMMDDHHmmss`), written once when the session began and never rebased. A
 * window is only repaired when the id agrees with the earliest event and
 * disagrees with the stored start — that pattern is the rebase and nothing else.
 *
 * Sessions whose events sit hours outside the window are NOT touched. Those are
 * bleed-over from an adjacent session, and widening a window to swallow them
 * would invent a workout that never happened — the opposite of a repair.
 *
 * Dry-run by default.
 *
 * @module cli/lib/fitness/repairSessionWindow
 */

import path from 'path';
import { existsSync, readdirSync } from 'fs';
import { parseArgs, bool, str } from './argv.mjs';
import { CliError } from './context.mjs';

/** The id and the first event must agree within this to corroborate a start. */
export const ID_AGREEMENT_MS = 5 * 60 * 1000;
/** Beyond this, an event is from another session, not this one's lost head. */
export const MAX_PLAUSIBLE_SPAN_MS = 6 * 60 * 60 * 1000;

export const spec = {
  name: 'repair-window',
  summary: 'restore session start/end that a resume rebased to the reload moment',
  usage: 'fitness session repair-window [--apply] [--since=YYYY-MM-DD]',
  details: `  --apply           Write changes (default: dry run)
  --since=DATE      Only scan date folders >= YYYY-MM-DD`,
};

/** `'YYYY-MM-DD HH:mm:ss.SSS'` → epoch ms (local, the session's own zone). */
export function parseClock(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = new Date(value.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** A `YYYYMMDDHHmmss` session id → epoch ms, or null. */
export function idToMs(sessionId) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(sessionId || ''));
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const ms = new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Format epoch ms back into the stored wall-clock shape. */
export function formatClock(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * What this session's window SHOULD be, or null to leave it alone.
 *
 * @param {Object} session - parsed session document
 * @returns {{startMs: number, endMs: number, reason: string}|null}
 */
export function planWindow(session) {
  const storedStart = parseClock(session?.session?.start);
  const storedEnd = parseClock(session?.session?.end);
  if (storedStart == null || storedEnd == null) return null;

  const stamps = [];
  for (const event of session?.timeline?.events || []) {
    const d = event?.data || {};
    if (Number.isFinite(d.start)) stamps.push(d.start);
    if (Number.isFinite(d.end)) stamps.push(d.end);
  }
  if (!stamps.length) return null;
  const firstEvent = Math.min(...stamps);
  const lastEvent = Math.max(...stamps);

  const idMs = idToMs(session?.sessionId ?? session?.session?.id);
  if (idMs == null) return null;

  // The id must vouch for the earliest event. Without that agreement the events
  // are not this session's lost head and the window stays as it is.
  if (Math.abs(idMs - firstEvent) > ID_AGREEMENT_MS) return null;
  // And the stored start must be LATER than the id. Direction matters: a rebase
  // can only push the start FORWARD, to the reload moment. A window that starts
  // EARLIER than its id is something else (a merge, a hand edit), and
  // "repairing" it would move the start forward and discard real minutes — the
  // 2026-02-03 session would have lost 18 of them to exactly that.
  if (storedStart <= idMs + ID_AGREEMENT_MS) return null;

  const startMs = Math.min(idMs, firstEvent);
  const endMs = Math.max(storedEnd, lastEvent);
  if (endMs - startMs > MAX_PLAUSIBLE_SPAN_MS) return null;
  if (endMs <= startMs) return null;

  return { startMs, endMs, reason: 'resume rebased the start; id and first event agree' };
}

function getSessionFiles(historyDir, since) {
  const dates = readdirSync(historyDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => !since || d >= since)
    .sort();
  const out = [];
  for (const date of dates) {
    const dir = path.join(historyDir, date);
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names.filter(n => n.endsWith('.yml'))) {
      out.push({ date, sessionId: name.replace(/\.yml$/, ''), filePath: path.join(dir, name) });
    }
  }
  return out;
}

export async function run(argv, ctx) {
  const { flags } = parseArgs(argv, { booleanFlags: ['apply'] });
  const APPLY = bool(flags, 'apply');
  const SINCE = str(flags, 'since') || null;

  const historyDir = ctx.fitnessHistoryDir;
  if (!existsSync(historyDir)) throw new CliError(`Fitness history directory not found: ${historyDir}`);

  console.log('Restore rebased session windows');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${SINCE ? ` | since ${SINCE}` : ''}\n`);

  let scanned = 0;
  let repaired = 0;

  for (const entry of getSessionFiles(historyDir, SINCE)) {
    const session = ctx.loadYamlSafe(entry.filePath);
    if (!session?.session) continue;
    scanned++;

    const plan = planWindow(session);
    if (!plan) continue;

    const wasMin = Math.round((parseClock(session.session.end) - parseClock(session.session.start)) / 60000);
    const nowMin = Math.round((plan.endMs - plan.startMs) / 60000);
    console.log(`  ${entry.date} ${entry.sessionId} | ${wasMin}min -> ${nowMin}min `
      + `| start ${session.session.start} -> ${formatClock(plan.startMs)}`);
    repaired++;

    if (APPLY) {
      session.session.start = formatClock(plan.startMs);
      session.session.end = formatClock(plan.endMs);
      session.session.duration_seconds = Math.round((plan.endMs - plan.startMs) / 1000);
      ctx.saveYaml(entry.filePath, session);
    }
  }

  console.log(`\nScanned ${scanned} sessions with a window.`);
  console.log(`Repaired ${repaired}.`);
  if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.');
  return { apply: APPLY, scanned, repaired };
}
