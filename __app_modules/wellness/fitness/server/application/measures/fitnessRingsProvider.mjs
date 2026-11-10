/**
 * `fitness.rings` — the first (and, in v1, only) weekly measure.
 *
 * Sums each participant's per-session ring total across the week's study days.
 * It reads `participants[learnerId].rings` off the session summaries the
 * datastore already returns — the number is computed at session close and
 * stored; nothing is re-derived here. Decoding every session's ring SERIES
 * instead would be far too heavy for a board that repaints every five minutes.
 *
 * Fitness participant ids and school learner ids share a namespace already
 * (`user_5`, `user_3`, `user_4`, `user_2`), so no mapping layer exists on purpose.
 * `kckern` is a fitness participant but not a school learner, which is fine:
 * this is asked per learner, so a non-learner is simply never asked about.
 */
import { evaluateRecapReadiness } from "../sessionConsolidationPolicy.mjs";

/** A summary's end: its `endTime`, else start + duration. Null when neither is known. */
function endOf(session, start) {
  const end = typeof session.endTime === 'number' ? session.endTime : Date.parse(session.endTime ?? '');
  if (Number.isFinite(end)) return end;
  return Number.isFinite(session.durationMs) ? start + session.durationMs : null;
}

/**
 * @param {object} deps
 * @param {{listSessions: (args: object) => Promise<object[]>}} deps.sessions
 *   anything exposing the session-summary list the fitness API already serves
 * @param {string} [deps.timezone]
 */
export function createFitnessRingsProvider({ sessions, timezone = 'UTC', studyDayFor, isInWindow, now = () => Date.now() }) {
  if (!sessions?.listSessions) {
    throw new Error('fitnessRingsProvider requires a sessions source with listSessions()');
  }

  if(typeof studyDayFor!=='function'||typeof isInWindow!=='function')throw new Error('fitnessRingsProvider requires installed study-day classification');

  return {
    id: 'fitness.rings',
    label: 'Rings',
    unit: 'rings',

    async total({ learnerId, from, to }) {
      if (!learnerId) return 0;
      const all = await sessions.listSessions({ from, to });
      let sum = 0;
      for (const session of all ?? []) {
        // A session is dated by the study day its START falls in, so a workout
        // that runs past 4am is not split across two weeks.
        const day = session.startTime
          ? studyDayFor(new Date(session.startTime), { timezone })
          : session.date;
        if (!isInWindow(day, { from, to })) continue;

        const rings = session.participants?.[learnerId]?.rings;
        if (Number.isFinite(rings)) sum += rings;
      }
      return sum;
    },

    /**
     * Every asked learner's rings from sessions STARTED in `[fromMs, toMs)` —
     * the economy's ring award week (Mon 04:00 → Sat 12:00, taxonomy D10),
     * which is an instant window, not whole study days. One listing for the
     * whole roster; a learner with no session reads 0.
     *
     * `sessions` lists the learner's sessions with rings, oldest first:
     * `{ sessionId, startMs, endMs, rings, title, final }`. `title` is the
     * primary media's (null when nothing played). `final` is the consolidation
     * policy's "settled" (finalized, or ended longer ago than the resume
     * window): until then the workout can still grow or be merged, so the
     * economy pays its rings only once it is final.
     * @returns {Promise<Array<{learnerId: string, rings: number, sessions: object[]}>>}
     */
    async standings({ learnerIds = [], fromMs, toMs }) {
      // List the study days the window touches, one day early for margin,
      // then keep only sessions whose start falls inside the instant window.
      const firstDay = studyDayFor(new Date(fromMs), { timezone });
      const from = new Date(Date.parse(`${firstDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const to = studyDayFor(new Date(toMs - 1), { timezone });
      const all = await sessions.listSessions({ from, to });
      const totals = new Map(learnerIds.map((id) => [id, 0]));
      const mine = new Map(learnerIds.map((id) => [id, []]));
      const at = now();
      for (const session of all ?? []) {
        const start = typeof session.startTime === 'number' ? session.startTime : Date.parse(session.startTime ?? '');
        if (!Number.isFinite(start) || start < fromMs || start >= toMs) continue;
        const endMs = endOf(session, start);
        const final = evaluateRecapReadiness({ finalized: session.finalized === true, endTime: endMs, now: at }).settled;
        const title = typeof session.media?.primary?.title === 'string' && session.media.primary.title.trim()
          ? session.media.primary.title.trim() : null;
        for (const id of learnerIds) {
          const rings = session.participants?.[id]?.rings;
          if (!Number.isFinite(rings)) continue;
          totals.set(id, totals.get(id) + rings);
          if (rings > 0) mine.get(id).push({ sessionId: String(session.sessionId ?? ''), startMs: start, endMs, rings, title, final });
        }
      }
      return learnerIds.map((learnerId) => ({
        learnerId,
        rings: totals.get(learnerId),
        sessions: mine.get(learnerId).sort((a, b) => a.startMs - b.startMs),
      }));
    },
  };
}

export default createFitnessRingsProvider;
