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
import { studyDayFor, isInWindow } from '#domains/measures/weeklyWindow.mjs';

/**
 * @param {object} deps
 * @param {{listSessions: (args: object) => Promise<object[]>}} deps.sessions
 *   anything exposing the session-summary list the fitness API already serves
 * @param {string} [deps.timezone]
 */
export function createFitnessRingsProvider({ sessions, timezone = 'UTC' }) {
  if (!sessions?.listSessions) {
    throw new Error('fitnessRingsProvider requires a sessions source with listSessions()');
  }

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
     * @returns {Promise<Array<{learnerId: string, rings: number}>>}
     */
    async standings({ learnerIds = [], fromMs, toMs }) {
      // List the study days the window touches, one day early for margin,
      // then keep only sessions whose start falls inside the instant window.
      const firstDay = studyDayFor(new Date(fromMs), { timezone });
      const from = new Date(Date.parse(`${firstDay}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const to = studyDayFor(new Date(toMs - 1), { timezone });
      const all = await sessions.listSessions({ from, to });
      const totals = new Map(learnerIds.map((id) => [id, 0]));
      for (const session of all ?? []) {
        const start = typeof session.startTime === 'number' ? session.startTime : Date.parse(session.startTime ?? '');
        if (!Number.isFinite(start) || start < fromMs || start >= toMs) continue;
        for (const id of learnerIds) {
          const rings = session.participants?.[id]?.rings;
          if (Number.isFinite(rings)) totals.set(id, totals.get(id) + rings);
        }
      }
      return learnerIds.map((learnerId) => ({ learnerId, rings: totals.get(learnerId) }));
    },
  };
}

export default createFitnessRingsProvider;
