/**
 * Use case: periodic recap sweep.
 *
 * The per-event recap triggers (explicit "End Session", emergency lockdown) only
 * fire on a minority of session ends. The common end paths — inactivity timeout,
 * a closed tab, a crashed client — never POST `/end`, so their captured frames
 * would pile up un-recapped forever (and never get cleaned up, since cleanup only
 * runs after a successful render). This sweep is the safety net: on a cron tick it
 * walks recent sessions and renders the recap for any that have settled (past the
 * resume/merge window) and still have camera captures but no finished recap.
 *
 * It is deliberately a thin orchestrator — every real decision lives in
 * GenerateSessionTimelapse.execute(): the merge-window defer (so it never jumps the
 * gun on a session that could still be resumed/merged) and the ready/processing
 * idempotency guard (so it never re-renders a finished recap whose frames were
 * already cleaned up). The pre-filter here just avoids loading/executing sessions
 * that the use case would no-op on anyway, keeping the tick quiet and cheap.
 *
 * Multi-instance safe: the Scheduler only ticks in the Docker/prod container, and
 * the `processing` status acts as a soft lock for any concurrent trigger.
 */
import { evaluateAbandonedSkeleton } from '../sessionConsolidationPolicy.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Recap statuses that mean "leave it alone" — finished, in flight, or no-captures. */
const TERMINAL_OR_INFLIGHT = new Set(['ready', 'processing', 'skipped']);

/** Most-recent capture time (ms epoch), or null if none of the captures are timestamped. */
function lastCaptureTimestamp(session) {
  const updatedAt = session?.snapshots?.updatedAt;
  if (Number.isFinite(updatedAt)) return updatedAt;
  let max = null;
  for (const c of session?.snapshots?.captures || []) {
    if (Number.isFinite(c?.timestamp) && (max == null || c.timestamp > max)) max = c.timestamp;
  }
  return max;
}

export class RecapSweep {
  #d;
  constructor(deps) { this.#d = deps; }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.householdId] - defaults to the configured household
   * @param {number} [opts.lookbackDays=2] - how many days back to scan (today + N prior)
   * @param {number} [opts.now] - current time ms (injectable for tests)
   */
  async run({ householdId, lookbackDays = 2, now = Date.now() } = {}) {
    const { sessionService, generateSessionTimelapse, configService, logger } = this.#d;
    const hid = householdId || configService?.getDefaultHouseholdId?.() || undefined;

    const dates = recentDateStrings(now, lookbackDays);
    const stats = { scanned: 0, triggered: 0, deferred: 0, rendered: 0, skipped: 0, failed: 0, reaped: 0, errors: 0 };

    logger?.info?.('fitness.recap_sweep.start', { householdId: hid || null, dates, lookbackDays });

    for (const date of dates) {
      let summaries;
      try {
        summaries = await sessionService.listSessionsByDate(date, hid);
      } catch (err) {
        stats.errors++;
        logger?.warn?.('fitness.recap_sweep.list_failed', { date, error: err?.message });
        continue;
      }

      for (const summary of summaries || []) {
        const sessionId = summary?.sessionId;
        if (!sessionId) continue;
        stats.scanned++;

        let session;
        try {
          session = await sessionService.getSession(sessionId, hid, { decodeTimeline: false });
        } catch (err) {
          stats.errors++;
          logger?.warn?.('fitness.recap_sweep.load_failed', { sessionId, error: err?.message });
          continue;
        }
        if (!session) continue;

        // Already finished / in flight / known no-captures — nothing to do.
        const status = session.timelapse?.status || null;
        if (status && TERMINAL_OR_INFLIGHT.has(status)) continue;

        // Needs camera captures to render anything (mirrors buildFrames' requirement).
        const hasCamera = (session.snapshots?.captures || [])
          .some(c => (c.role || 'camera') === 'camera');
        if (!hasCamera) continue;

        // Reap abandoned skeletons: the always-on screenshot capture creates a
        // session record even when no rider tags in, but the persistence roster
        // gate then refuses to ever write an endTime — so the recap below would
        // defer it forever (reason `not-ended`) while its frames leak. Once such a
        // rosterless, never-ended record has stopped capturing past the merge
        // window it can neither be recapped nor resumed, so delete it outright
        // (deleteSession removes both the YAML record and the screenshot frames).
        const reap = evaluateAbandonedSkeleton({
          finalized: session.finalized,
          endTime: session.endTime,
          rosterSize: Array.isArray(session.roster) ? session.roster.length : 0,
          lastCaptureMs: lastCaptureTimestamp(session),
          now
        });
        if (reap.reap) {
          try {
            await sessionService.deleteSession(sessionId, hid);
            stats.reaped++;
            logger?.info?.('fitness.recap_sweep.reaped', { sessionId, reason: reap.reason });
          } catch (err) {
            stats.errors++;
            logger?.warn?.('fitness.recap_sweep.reap_failed', { sessionId, error: err?.message });
          }
          continue;
        }

        // Hand off to the use case — it owns the merge-window defer + render/cleanup.
        stats.triggered++;
        try {
          const result = await generateSessionTimelapse.execute({ sessionId, householdId: hid });
          if (result?.status === 'ready') stats.rendered++;
          else if (result?.status === 'deferred') stats.deferred++;
          else if (result?.status === 'skipped') stats.skipped++;
          else if (result?.status === 'failed') stats.failed++;
        } catch (err) {
          stats.failed++;
          logger?.error?.('fitness.recap_sweep.execute_failed', { sessionId, error: err?.message });
        }
      }
    }

    logger?.info?.('fitness.recap_sweep.done', { householdId: hid || null, ...stats });
    return stats;
  }
}

/** YYYY-MM-DD strings for today and the prior `lookbackDays` days (local time). */
export function recentDateStrings(now, lookbackDays) {
  const out = [];
  for (let i = 0; i <= lookbackDays; i++) {
    out.push(toLocalDateString(new Date(now - i * DAY_MS)));
  }
  return out;
}

function toLocalDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
