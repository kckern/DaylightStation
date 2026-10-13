/**
 * Project fitness session summaries into the small physical-education evidence
 * summary used by the teacher day — the sibling of `readingActivity.mjs`, and
 * for the same reason: a child can do real work in a subject nobody enrolled
 * them in, and the day board should say so.
 *
 * TWO WAYS TO EARN IT, AND WHY NEITHER IS BARE MEMBERSHIP. A heart-rate strap
 * that wanders past the garage gets picked up by whatever session is running,
 * so `participants` membership alone would hand out credit for a workout
 * somebody else did.
 *
 * Rings are the first way: computed at session close from that participant's
 * own effort, already stored on the session summary
 * (`YamlSessionDatastore.findByDate`), so `rings > 0` is the cheapest honest
 * proof that this child moved. Nothing is re-derived here and no ring SERIES is
 * decoded — far too heavy for a board that repaints every five minutes.
 *
 * TIME IS THE SECOND WAY, and it is here for the youngest rider. Rings scale
 * with effort, and a preschooler pedalling a bike can spend twenty real minutes
 * in the garage and score zero — across five weeks of household sessions, every
 * zero-ring learner row belonged to the same small child, two of them at 16.8
 * and 19.2 minutes. Crediting nothing for those would tell a four-year-old that
 * what he actually did does not count, which is the opposite of what this disc
 * is for. So a participant who was present for `MIN_PRESENCE_MINUTES` of zone
 * time is credited whatever the rings say.
 *
 * The floor still does the guarding: the third zero-ring row in that same data
 * was one minute — a strap put on and taken off — and ten minutes excludes it
 * with room to spare in both directions.
 *
 * Fitness participant ids and school learner ids share one namespace already —
 * the same first-name slugs on both sides, verified against the live session
 * log and `school.yml` — so there is no mapping layer on purpose, the same
 * decision `fitnessRingsProvider.mjs` documents (its `user_2`/`user_4` example
 * is stale; the claim it makes is not). A fitness-only participant is simply
 * never asked about, because this is asked per learner.
 *
 * Calendar interpretation belongs to the caller: `dayOf` must use the same
 * timezone and 4am boundary as the requested study day.
 */

/**
 * Zone time that earns credit on its own, in minutes. Round, and comfortably
 * clear of both the one-minute strap blip below it and the real stints above.
 */
const MIN_PRESENCE_MINUTES = 10;

/** Total minutes this participant spent in any heart-rate zone. */
function minutesPresent(participant) {
  const zones = participant?.zoneMinutes;
  if (!zones || typeof zones !== 'object') return 0;
  return Object.values(zones).reduce((sum, minutes) => (
    Number.isFinite(minutes) ? sum + minutes : sum
  ), 0);
}

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

    const participant = session.participants?.[learnerId];
    if (!participant) continue;

    // `null` is "no ring data recorded" and 0 is a real zero. Either can still
    // be a real workout for a small rider, so time gets the second word.
    const earned = participant.rings;
    const scored = Number.isFinite(earned) && earned > 0;
    if (!scored && minutesPresent(participant) < MIN_PRESENCE_MINUTES) continue;

    if (scored) rings += earned;
    sessionCount += 1;
  }

  return { studyDay, hasActivity: sessionCount > 0, rings, sessionCount };
}

export default projectFitnessActivity;
