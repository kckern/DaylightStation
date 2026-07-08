// backend/src/3_applications/fitness/webhookCoachingPolicy.mjs
//
// Domain rule for provider (Strava) webhook events: whether a just-created
// activity warrants a coaching "exercise reaction" nudge. Kept out of the API
// router so the threshold lives with the rest of the fitness application policy.

/**
 * Minimum calories a workout must burn before it earns a coaching reaction.
 * Below this the activity is treated as noise (a short walk, a mis-fire).
 */
export const EXERCISE_REACTION_MIN_CALORIES = 200;

/**
 * @param {object} event - parsed FitnessProviderEvent (reads `.calories`)
 * @returns {boolean} true iff the activity should trigger a coaching reaction
 */
export function shouldSendExerciseReaction(event) {
  return (event?.calories || 0) > EXERCISE_REACTION_MIN_CALORIES;
}
