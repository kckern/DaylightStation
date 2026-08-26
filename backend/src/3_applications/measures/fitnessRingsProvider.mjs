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
 * (`alan`, `felix`, `milo`, `soren`), so no mapping layer exists on purpose.
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
  };
}

export default createFitnessRingsProvider;
