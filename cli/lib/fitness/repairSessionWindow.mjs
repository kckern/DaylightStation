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
import { decodeStoredSeries, encodeStoredSeries } from './seriesWire.mjs';
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


/**
 * Re-align the tick series to a window whose start has moved earlier.
 *
 * Tick 0 means "the session start". Moving the start WITHOUT moving the data
 * silently re-dates every sample: session 20260901154746's 235 ticks were
 * recorded from 16:09:51, and after the window was restored to 15:47:43 the
 * chart drew them as the session's first 20 minutes and clamped every later
 * media marker onto the right edge — a header reading 94m above an axis reading
 * 0:00–19:35.
 *
 * Leading nulls put the samples back where they happened. Trailing nulls extend
 * the axis to the full window, so the stretch the browser was not recording
 * reads as absent rather than as the whole session.
 *
 * @param {Object} session - mutated in place
 * @param {number} leadTicks - ticks between the new start and the old one
 * @param {number} totalTicks - ticks spanned by the repaired window
 * @returns {number} series re-aligned
 */
export function realignSeries(session, leadTicks, totalTicks) {
  const stored = session?.timeline?.series;
  if (!stored || (leadTicks <= 0 && !(totalTicks > 0))) return 0;
  const decoded = decodeStoredSeries(stored);
  const keys = Object.keys(decoded);
  if (!keys.length) return 0;

  for (const key of keys) {
    const values = decoded[key];
    const lead = leadTicks > 0 ? new Array(leadTicks).fill(null) : [];
    const merged = [...lead, ...values];
    while (merged.length < totalTicks) merged.push(null);
    decoded[key] = merged;
  }
  session.timeline.series = encodeStoredSeries(decoded);
  session.timeline.tick_count = Math.max(totalTicks, 0);
  return keys.length;
}


/**
 * Record a series that the history cap truncated.
 *
 * `_pruneSeriesWindow` used to drop the oldest ticks silently while `tickCount`
 * kept advancing, so a file could claim 2346 ticks over a 2000-tick series and
 * nothing said which end was missing. Session 20260725132556 lost its first 29
 * minutes that way.
 *
 * The loss is not recoverable, but it IS describable: the gap between the tick
 * counter and the series length is exactly how many ticks came off the front.
 * Writing it down lets a reader realign index 0 to its true tick instead of
 * reading a windowed series as a whole one.
 *
 * @param {Object} session - mutated in place
 * @returns {number} ticks recorded as pruned, 0 if none
 */
export function recordPrunedHead(session) {
  const timeline = session?.timeline;
  if (!timeline) return 0;
  const tickCount = Number(timeline.tick_count) || 0;
  if (!tickCount) return 0;
  if (Number(timeline.pruned_ticks) > 0) return 0;

  const decoded = decodeStoredSeries(timeline.series || {});
  const lengths = Object.values(decoded).map(v => v.length).filter(n => n > 0);
  if (!lengths.length) return 0;
  const longest = Math.max(...lengths);

  // A couple of ticks of slack is ordinary; a real prune is hundreds.
  const lost = tickCount - longest;
  if (lost <= 5) return 0;
  timeline.pruned_ticks = lost;
  return lost;
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

    // Independent of the window repair: a truncated series must at least say so.
    const prunedHead = recordPrunedHead(session);
    if (prunedHead) {
      console.log(`  ${entry.date} ${entry.sessionId} | series head pruned: recorded ${prunedHead} lost tick(s)`);
      repaired++;
      if (APPLY) ctx.saveYaml(entry.filePath, session);
    }

    const plan = planWindow(session);
    if (!plan) continue;

    const wasMin = Math.round((parseClock(session.session.end) - parseClock(session.session.start)) / 60000);
    const nowMin = Math.round((plan.endMs - plan.startMs) / 60000);
    console.log(`  ${entry.date} ${entry.sessionId} | ${wasMin}min -> ${nowMin}min `
      + `| start ${session.session.start} -> ${formatClock(plan.startMs)}`);
    repaired++;

    // The series must move with the window, or the chart re-dates every sample.
    const intervalMs = (Number(session.timeline?.interval_seconds) || 5) * 1000;
    const oldStartMs = parseClock(session.session.start);
    const leadTicks = Math.round((oldStartMs - plan.startMs) / intervalMs);
    const totalTicks = Math.ceil((plan.endMs - plan.startMs) / intervalMs);
    console.log(`      series: +${leadTicks} leading tick(s), axis -> ${totalTicks} ticks`);

    if (APPLY) {
      realignSeries(session, leadTicks, totalTicks);
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
