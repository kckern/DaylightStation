// backend/src/3_applications/fitness/usecases/PrepareWorkoutRun.mjs
//
// Everything Run needs to walk a workout: the expanded step list, plus the corpus
// display records those steps point at.
//
// WHY THIS USE CASE EXISTS
// ------------------------
// `expandWorkout` (2_domains/fitness/workout/workout.mjs) owns the ordering — its own
// docblock says the player must not re-derive it, and that "the Run use case is expected
// to join each step against the corpus (resolving `slug` to a name and a GIF url) before
// it reaches the client". The frontend cannot import that module: no build alias resolves
// `backend/src` from browser code, and a second copy of the expansion under `frontend/`
// is precisely the duplicated-ordering bug the domain module exists to prevent. So the
// expansion happens HERE, once, and the client renders what it is handed.
//
// This is also the only layer that can do the JOIN. The domain deliberately has no corpus
// access (it must stay expandable without the 1,296-record index in memory) and the
// workout repository deliberately has none either (it only knows files). This use case
// holds both, exactly as `SaveWorkout` does for the write path.
//
// SAVED WORKOUT *AND* UNSAVED DRAFT
// ---------------------------------
// Build's "Start workout" is a target of its own, next to but independent of "Save".
// Someone who assembles a plan at the rack and taps Start has an id only if they also
// tapped Save. Requiring a save first would either break the primary gesture or force an
// implicit one, littering the shared shelf with plans nobody chose to keep. So a run can
// be prepared from an ID (the saved shelf; deep-linkable) or from an INLINE workout (the
// draft in the builder's hands). One code path serves both: the source of the record
// differs, the expansion and the join do not.
//
// A VANISHED SLUG IS NOT AN ERROR
// -------------------------------
// `SaveWorkout` refuses unknown slugs at authoring time, but the corpus is rebuilt from a
// cloud-synced tree by a CLI, so a stored workout CAN outlive an exercise. That must not
// 500 in front of someone standing under a loaded bar. The step still expands, the lookup
// simply carries no entry for it (the runner falls back to the humanised slug and a
// placeholder), and the slug is reported in `missingSlugs` so the gap is visible.

import { expandWorkout, makeWorkout } from '#domains/fitness/workout/workout.mjs';

/**
 * What a running screen draws for one exercise, and nothing else.
 *
 * The full corpus record carries instruction prose, stills and a video (~1.6 KB each);
 * a run screen shows a name and one animated demo. Shipping bodies for a 12-exercise
 * plan would be an order of magnitude more wire for nothing rendered.
 */
function toDisplayRecord(exercise) {
  return {
    name: typeof exercise?.name === 'string' && exercise.name.trim() ? exercise.name.trim() : null,
    image: typeof exercise?.image === 'string' && exercise.image.trim() ? exercise.image.trim() : null,
  };
}

export class PrepareWorkoutRun {
  #repository;
  #library;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.workoutRepository YamlWorkoutRepository — `get(id, householdId)`.
   * @param {Object} deps.exerciseLibrary The exercise library repository — `getExercise(slug)`
   *   answering null for an unknown slug is the whole contract needed here. Injected, never
   *   constructed: this layer may not import an adapter, and the composition root already
   *   holds the one loaded instance (a second would re-parse 2.8 MB of YAML).
   * @param {Object} [deps.logger]
   */
  constructor({ workoutRepository, exerciseLibrary, logger = console } = {}) {
    if (!workoutRepository) throw new Error('PrepareWorkoutRun requires workoutRepository');
    if (!exerciseLibrary) throw new Error('PrepareWorkoutRun requires exerciseLibrary');
    this.#repository = workoutRepository;
    this.#library = exerciseLibrary;
    this.#logger = logger ?? console;
  }

  /**
   * Expand one workout and join it against the corpus.
   *
   * Exactly one of `workoutId` / `workout` is used: an inline record wins, because a caller
   * that sent a draft body is asking for THAT plan even if it also carries the id of the
   * shelf copy it was last saved as. (Build keeps editing after a save; the draft in hand
   * is the one the person is about to perform.)
   *
   * @param {Object} input
   * @param {string} [input.workoutId] Id of a stored workout.
   * @param {Object} [input.workout] An authored record, raw — normalized here.
   * @param {string|null} [input.householdId]
   * @returns {{ok: true, workout: {id: string|null, title: string|null},
   *            steps: Array<Object>, exercises: Object, missingSlugs: string[]}
   *          |{ok: false, reason: string, error: string}}
   */
  execute({ workoutId = null, workout = null, householdId = null } = {}) {
    const source = workout != null
      ? makeWorkout(workout)
      : this.#load(workoutId, householdId);

    if (!source) {
      if (!workoutId) {
        return { ok: false, reason: 'missing_workout', error: 'workoutId or workout is required' };
      }
      this.#logger.warn?.('fitness.workouts.run.unknown', { workoutId });
      return { ok: false, reason: 'unknown_workout', error: `unknown workout "${workoutId}"` };
    }

    const steps = expandWorkout(source);
    const { exercises, missingSlugs } = this.#lookupFor(steps);

    this.#logger.info?.('fitness.workouts.run.prepared', {
      id: source.id ?? null,
      draft: workout != null,
      steps: steps.length,
      workSteps: steps.filter((step) => step.kind === 'work').length,
      exercises: Object.keys(exercises).length,
      missing: missingSlugs.length,
    });

    return {
      ok: true,
      workout: { id: source.id ?? null, title: source.title ?? null },
      steps,
      exercises,
      missingSlugs,
    };
  }

  /** The stored record, or null for an id that names nothing (an unsafe id included). */
  #load(workoutId, householdId) {
    if (!workoutId) return null;
    return this.#repository.get(workoutId, householdId);
  }

  /**
   * slug -> { name, image } for every DISTINCT slug the steps mention.
   *
   * Distinct, because a superset walks the same two slugs six times and the lookup is a
   * map, not a per-step field: repeating the display record on every step would multiply
   * the payload by the round count for no rendering gain.
   *
   * Rest steps carry `afterSlug`/`nextSlug` (the runner labels a countdown with the
   * exercise on either side of it), so they contribute their slugs too — a lookup built
   * from work steps alone would leave the rest screen showing humanised slugs while the
   * work screens either side of it show real names.
   *
   * Null prototype for the same reason the corpus's own slug maps have one: slugs are
   * third-party strings, and `exercises['__proto__'] = record` on a plain object would
   * not create an own property at all — the record would simply vanish. (It serializes
   * identically; `JSON.stringify` reads own enumerable properties.)
   */
  #lookupFor(steps) {
    const exercises = Object.create(null);
    const missingSlugs = [];
    for (const step of steps) {
      for (const slug of [step?.slug, step?.afterSlug, step?.nextSlug]) {
        if (typeof slug !== 'string' || slug === '') continue;
        if (Object.hasOwn(exercises, slug) || missingSlugs.includes(slug)) continue;
        // `getExercise` answers null for an unknown slug — see A VANISHED SLUG above.
        const record = this.#library.getExercise(slug);
        if (record == null) {
          missingSlugs.push(slug);
          continue;
        }
        exercises[slug] = toDisplayRecord(record);
      }
    }
    return { exercises, missingSlugs };
  }
}

export default PrepareWorkoutRun;
