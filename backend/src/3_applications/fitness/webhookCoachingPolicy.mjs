// backend/src/3_applications/fitness/webhookCoachingPolicy.mjs
//
// Domain rule: whether a newly created provider (Strava) activity warrants a
// coaching "exercise reaction". Judged on the FETCHED activity — the webhook
// event itself carries no calories, which is why the old event-based check
// could never pass.

/**
 * Minimum calories a workout must burn before it earns a coaching reaction.
 * Below this the activity is treated as noise (a short walk, a mis-fire).
 */
export const EXERCISE_REACTION_MIN_CALORIES = 200;

/**
 * @param {{calories?: number, start_date?: string}} activity - provider activity detail
 * @param {Object} opts
 * @param {Date} opts.now
 * @param {string} opts.timezone - the user's timezone
 * @param {number} [opts.minCalories]
 * @returns {boolean} true iff the activity burned enough AND started today (local) —
 *   the reaction talks about today's budget, so a late-synced old workout is silent
 */
export function shouldSendExerciseReaction(activity, { now, timezone, minCalories = EXERCISE_REACTION_MIN_CALORIES }) {
  if (!((activity?.calories || 0) > minCalories)) return false;
  const start = activity?.start_date ? new Date(activity.start_date) : null;
  if (!start || Number.isNaN(start.getTime())) return false;
  const localDay = (d) => d.toLocaleDateString('en-CA', { timeZone: timezone });
  return localDay(start) === localDay(now);
}

/** Provider activity → the orchestrator's reaction shape. */
export function toReactionActivity(activity) {
  return {
    id: activity.id,
    type: activity.sport_type || activity.type || 'Workout',
    durationMin: Math.round((activity.moving_time || activity.elapsed_time || 0) / 60),
    caloriesBurned: Math.round(activity.calories || 0),
  };
}
