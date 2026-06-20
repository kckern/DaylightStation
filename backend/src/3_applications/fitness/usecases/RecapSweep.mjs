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

/**
 * Session start time (ms epoch) derived from its id, which encodes the local wall
 * clock at start (`[fs_]YYYYMMDDHHMMSS`). Used as the staleness fallback for a
 * skeleton that never recorded a timestamped capture. Returns NaN for a malformed id.
 */
function sessionStartMsFromId(sessionId) {
  const digits = String(sessionId || '').replace(/\D/g, '');
  if (digits.length < 14) return NaN;
  const [y, mo, d, h, mi, s] = [
    digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8),
    digits.slice(8, 10), digits.slice(10, 12), digits.slice(12, 14)
  ].map(Number);
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isNaN(t) ? NaN : t;
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
    const { sessionService, generateSessionTimelapse, garbageCollector, configService, logger } = this.#d;
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

        // Reap abandoned skeletons FIRST, before the camera-captures guard. The
        // always-on screenshot capture creates a session record even when no rider
        // tags in, but the persistence roster gate then refuses to ever write an
        // endTime — so the recap below would defer it forever (reason `not-ended`)
        // while its frames leak. Such a rosterless, never-ended record can neither
        // be recapped nor resumed; once it has stopped showing activity past the
        // merge window, delete it outright (deleteSession removes both the YAML
        // record and any screenshot frames). Checking before the camera guard is
        // what lets player-only and zero-capture skeletons get reaped too — the
        // guard below would otherwise skip them and they'd linger forever.
        const reap = evaluateAbandonedSkeleton({
          finalized: session.finalized,
          endTime: session.endTime,
          rosterSize: Array.isArray(session.roster) ? session.roster.length : 0,
          // Best activity signal: newest capture, else the session's own start time
          // derived from its id (so a never-captured skeleton still ages out).
          lastCaptureMs: lastCaptureTimestamp(session) ?? sessionStartMsFromId(sessionId),
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

        // Needs camera captures to render anything (mirrors buildFrames' requirement).
        const hasCamera = (session.snapshots?.captures || [])
          .some(c => (c.role || 'camera') === 'camera');
        if (!hasCamera) continue;

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

    // Janitor pass on the same tick: now that abandoned skeletons are reaped, sweep
    // the media frame store for empty shells, orphan frames, and un-recappable
    // leftovers. Isolated so a GC failure never fails the recap sweep.
    if (garbageCollector) {
      try {
        stats.gc = await garbageCollector.run({ householdId: hid, now });
      } catch (err) {
        logger?.warn?.('fitness.recap_sweep.gc_failed', { error: err?.message });
      }
    }

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
