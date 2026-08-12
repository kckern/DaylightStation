/**
 * Workout Domain (Fitness)
 *
 * The structure Build authors and Run performs: a Workout of ExerciseGroups, each group's
 * kind derived from its size, and `expandWorkout` flattening the whole thing into the flat
 * ordered step list the player walks one screen at a time.
 *
 * Exercises are referenced by `slug` only. The corpus vocabulary they point into is shared
 * with School and lives in `2_domains/exercise/`; nothing here imports it.
 */

export {
  makeWorkout,
  makeExerciseGroup,
  makeWorkoutExercise,
  groupKind,
  expandWorkout,
} from './workout.mjs';

/**
 * What a finished run leaves behind: the strength block that hangs off the existing
 * fitness session record, so a workout shows up in history beside the cycle rides.
 */
export {
  presentParticipantIds,
  makeStrengthRun,
  appendStrengthRun,
} from './strengthLog.mjs';
