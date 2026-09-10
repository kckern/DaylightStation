/**
 * Project fitness session summaries into the small physical-education evidence
 * summary used by the teacher day — the sibling of `readingActivity.mjs`, and
 * for the same reason: a child can do real work in a subject nobody enrolled
 * them in, and the day board should say so.
 *
 * WHY RINGS AND NOT MERE PRESENCE. A heart-rate strap that wanders past the
 * garage gets picked up by whatever session is running, so `participants`
 * membership alone would hand out credit for a workout somebody else did.
 * Rings are computed at session close from that participant's own effort, so
 * `rings > 0` is the cheapest honest proof that this child moved. The number is
 * already stored on the session summary (`YamlSessionDatastore.findByDate`);
 * nothing is re-derived here, and no ring SERIES is decoded — far too heavy for
 * a board that repaints every five minutes.
 *
 * Fitness participant ids and school learner ids share one namespace already
 * (`user_2`, `user_4`, …), so there is no mapping layer on purpose — the same
 * decision `fitnessRingsProvider.mjs` documents. A fitness-only participant is
 * simply never asked about, because this is asked per learner.
 *
 * Calendar interpretation belongs to the caller: `dayOf` must use the same
 * timezone and 4am boundary as the requested study day.
 */

/**
 * @param {object[]} sessions session summaries for a window covering the day
 * @param {{learnerId: string, studyDay: string, dayOf: (ms: number) => string}} options
 * @returns {{studyDay: string, hasActivity: boolean, rings: number, sessionCount: number}}
 */
export function projectFitnessActivity(sessions, { learnerId, studyDay, dayOf } = {}) {
  if (!learnerId) throw new Error('projectFitnessActivity requires learnerId');
  if (typeof dayOf !== 'function') throw new Error('projectFitnessActivity requires dayOf');

  let rings = 0;
  let sessionCount = 0;

  for (const session of (Array.isArray(sessions) ? sessions : [])) {
    // A session is dated by the study day its START falls in, so a workout that
    // runs past the boundary is not counted twice or moved to tomorrow. A
    // summary with no start instant is skipped rather than guessed at.
    if (!Number.isFinite(session?.startTime)) continue;
    if (dayOf(session.startTime) !== studyDay) continue;

    const earned = session.participants?.[learnerId]?.rings;
    // `null` is "no ring data recorded" and 0 is a real zero; neither is work.
    if (!Number.isFinite(earned) || earned <= 0) continue;

    rings += earned;
    sessionCount += 1;
  }

  return { studyDay, hasActivity: sessionCount > 0, rings, sessionCount };
}

export default projectFitnessActivity;
