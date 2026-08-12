// backend/src/3_applications/fitness/usecases/SaveWorkout.mjs
//
// The write path for authored workouts: validate against the corpus, then persist.
//
// WHY VALIDATION LIVES HERE
// -------------------------
// The domain (`2_domains/fitness/workout/workout.mjs`) deliberately cannot check a slug —
// it never imports the 1,296-record corpus, so an authored plan stays readable and
// expandable without the index in memory. The repository deliberately cannot either; it
// only knows files. This use case is the one place that holds BOTH the plan and the
// library index, so it is the only place that can refuse a workout pointing at an
// exercise that does not exist.
//
// And it must refuse. A workout with a bad slug survives the save, sits in the picker
// looking fine, and then fails at Run time — in front of somebody mid-session, standing
// at a rack, with no way to tell what went wrong. Rejecting at save time puts the failure
// in front of the person who can actually fix it, at the moment they typed it.
//
// ALL BAD SLUGS, NOT THE FIRST. Someone who mistyped three exercise names should learn
// all three from one save, not discover them one round-trip at a time. Every group is
// walked to completion and the offending slugs are reported together.

import { makeWorkout } from '#domains/fitness/workout/workout.mjs';

/**
 * Ids must be usable as filenames, because that is what the repository makes of them.
 *
 * The application layer may not import an adapter (`apps-no-adapters`), so the shape is
 * restated rather than imported, and the repository re-checks it on write as containment.
 * The duplication is deliberate: this copy exists to turn a bad id into a 400 that names
 * the problem, and that copy exists so no bug anywhere can address a file outside the
 * workouts directory. Neither can be deleted in favour of the other.
 */
const WORKOUT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** @returns {boolean} whether `id` may be used as a workout id. */
function isValidWorkoutId(id) {
  return typeof id === 'string' && WORKOUT_ID_PATTERN.test(id);
}

/** Longest slug-from-title stem; leaves room for the `-xxxx` uniqueness suffix. */
const MAX_TITLE_STEM = 40;

/** Fallback stem when a workout has no usable title. */
const DEFAULT_STEM = 'workout';

/**
 * Derive a filename-safe stem from a title.
 *
 * Ids are filenames people will see in a Dropbox-synced data directory, so a readable
 * stem ("full-body-friday-k3f9") beats an opaque uuid when someone is looking at the
 * folder to figure out what a file is. Uniqueness comes from the suffix, not the stem.
 */
function titleStem(title) {
  const stem = String(title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TITLE_STEM)
    .replace(/-+$/g, '');
  return stem === '' ? DEFAULT_STEM : stem;
}

/** Four base-36 characters of entropy — enough that a collision retry is nearly never hit. */
function defaultSuffix() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export class SaveWorkout {
  #repository;
  #library;
  #logger;
  #suffix;

  /**
   * @param {Object} deps
   * @param {Object} deps.workoutRepository YamlWorkoutRepository (save/exists).
   * @param {Object} deps.exerciseLibrary Exercise library repository — `getExercise(slug)`
   *   returning null for an unknown slug is the whole contract this use case needs.
   * @param {Object} [deps.logger]
   * @param {Function} [deps.makeSuffix] Test seam for the id uniqueness suffix.
   */
  constructor({ workoutRepository, exerciseLibrary, logger = console, makeSuffix = defaultSuffix } = {}) {
    if (!workoutRepository) throw new Error('SaveWorkout requires workoutRepository');
    if (!exerciseLibrary) throw new Error('SaveWorkout requires exerciseLibrary');
    this.#repository = workoutRepository;
    this.#library = exerciseLibrary;
    this.#logger = logger ?? console;
    this.#suffix = makeSuffix;
  }

  /**
   * Validate and persist one authored workout.
   *
   * An id carried in the payload is an UPDATE of that workout, not a request for a new
   * one — Build owns the id once it has one, and a save retried after a flaky response
   * must not litter the shelf with duplicates of the same plan. An absent id means a new
   * workout and one is generated.
   *
   * @param {Object} input
   * @param {Object} input.workout The authored record (raw; normalized here).
   * @param {string|null} [input.householdId]
   * @returns {{ok: true, id: string, created: boolean, createdAt: string, updatedAt: string}
   *          |{ok: false, error: string, unknownSlugs: string[], issues: string[]}}
   */
  execute({ workout, householdId = null } = {}) {
    const normalized = makeWorkout(workout);

    const issues = [];
    if (normalized.id !== null && !isValidWorkoutId(normalized.id)) {
      issues.push(`invalid workout id: ${JSON.stringify(normalized.id)}`);
    }

    // Walk EVERY exercise of EVERY group before reporting anything.
    const unknownSlugs = [];
    normalized.groups.forEach((group, groupIndex) => {
      group.exercises.forEach((exercise, exerciseIndex) => {
        const where = `group ${groupIndex + 1}, exercise ${exerciseIndex + 1}`;
        if (exercise.slug === '') {
          issues.push(`${where} is missing an exercise slug`);
          return;
        }
        // `getExercise` answers null for an unknown slug — that is the whole check.
        if (this.#library.getExercise(exercise.slug) == null
          && !unknownSlugs.includes(exercise.slug)) {
          unknownSlugs.push(exercise.slug);
        }
      });
    });

    if (unknownSlugs.length > 0) {
      issues.push(`unknown exercise ${unknownSlugs.length === 1 ? 'slug' : 'slugs'}: ${
        unknownSlugs.map((slug) => `"${slug}"`).join(', ')}`);
    }

    if (issues.length > 0) {
      const error = issues.join('; ');
      this.#logger.warn?.('fitness.workouts.save.rejected', {
        id: normalized.id, unknownSlugs, issues: issues.length,
      });
      return { ok: false, error, unknownSlugs, issues };
    }

    const id = normalized.id ?? this.#generateId(normalized.title, householdId);
    const saved = this.#repository.save({ ...normalized, id }, householdId);
    this.#logger.info?.('fitness.workouts.save.ok', {
      id, created: saved.created, groups: normalized.groups.length,
    });
    return {
      ok: true,
      id,
      created: saved.created,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  /**
   * A readable, unused id. The suffix makes collisions rare; the retry makes them
   * impossible to observe, because overwriting somebody else's workout because two
   * people both titled theirs "Leg Day" is not an acceptable failure mode.
   */
  #generateId(title, householdId) {
    const stem = titleStem(title);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = `${stem}-${this.#suffix()}`;
      if (isValidWorkoutId(candidate) && !this.#repository.exists(candidate, householdId)) {
        return candidate;
      }
    }
    return `${DEFAULT_STEM}-${Date.now().toString(36)}`;
  }
}

export default SaveWorkout;
