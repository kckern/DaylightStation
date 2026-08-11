/**
 * Exercise Reference Domain
 *
 * The shared corpus vocabulary — Exercise, Muscle, MuscleGroup, Equipment — spoken by
 * both the Fitness browse/build/run module and the School anatomy shelf. Fitness-only
 * concepts (Workout, supersets, sets/reps/rest) live in `2_domains/fitness/workout/`.
 */

export {
  makeExercise,
  makeMuscle,
  makeMuscleGroup,
  makeEquipment,
  exerciseMatchesFilter,
} from './entities.mjs';
