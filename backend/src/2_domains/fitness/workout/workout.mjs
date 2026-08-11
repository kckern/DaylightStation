// backend/src/2_domains/fitness/workout/workout.mjs
//
// The workout Build authors and Run performs.
//
// WHY THIS EXISTS
// ---------------
// `2_domains/exercise/` is the corpus vocabulary two apps share. A Workout is not that:
// sets, supersets, rounds and rest are meaningful only to Fitness, so they live here and
// the corpus stays free of them. This module references exercises by `slug` alone and
// deliberately does not import the corpus domain — an authored workout is a plan, and a
// plan can be read, stored and expanded without the 1,287-record index being in memory.
//
// The centre of gravity is {@link expandWorkout}: it flattens the authored nesting
// (workout -> group -> round -> exercise -> set -> rest) into the flat ordered list the
// Run player walks one screen at a time. Every step carries what the player needs to
// render it, so the player never re-derives ordering — the ordering bug that shows the
// wrong exercise at the wrong time can then only exist in one place, here, under test.
//
// CONTRACTS
// ---------
// - Pure. No I/O, no clock, no randomness, no logging.
// - The factories never throw on bad input, matching `2_domains/exercise/entities.mjs`:
//   a defective record still yields a usable object, and missing collections become empty
//   arrays, never `undefined`.
// - AUTHORED objects (Workout / ExerciseGroup / WorkoutExercise) are frozen, arrays
//   included, and input arrays are copied rather than aliased. Same reasoning as the
//   corpus: a repository is free to cache a parsed workout and hand the same object to
//   every request, and an in-place sort by one consumer would corrupt it for the rest.
// - DERIVED steps are NOT frozen. That reasoning does not transfer: a step list is built
//   fresh on every call and shared with nobody, and the Run use case is expected to join
//   each step against the corpus (resolving `slug` to a name and a GIF url) before it
//   reaches the client. Freezing would buy no safety and force a wasteful copy.
// - `expandWorkout` cannot validate slugs — it has no corpus access, by design. An
//   unknown slug expands into a step like any other. Rejecting a workout that references
//   a missing exercise belongs to the save use case, which does hold the index.

/** Coerce a YAML/JSON scalar to a trimmed string, or null. Objects are not text. */
function toText(value) {
  if (value == null || typeof value === 'object') return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

/**
 * Coerce a required count (sets, rounds, rest) to a whole number >= 0.
 *
 * Absent and unparseable both fall back, but an explicit `0` is preserved — that is the
 * difference between "the author said nothing" and "the author said none", and a group
 * with `rounds: 0` must expand to nothing rather than quietly running once.
 */
function toCount(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** Coerce an optional target (reps, seconds) to a whole number >= 0, or null. */
function toOptionalCount(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

/**
 * Normalize one exercise entry inside a group.
 *
 * REPS vs SECONDS — an entry is either counted or timed, never both. The builder toggles
 * between the two modes, so a record carrying both is an authoring accident rather than a
 * request for both. Resolving it here, once, means `expandWorkout` and the player never
 * have to decide which one wins: `reps` does, and `seconds` is cleared. Reps is the
 * manual-advance mode, so the failure of a wrong guess is a runner that waits for a tap
 * instead of one that counts down over an exercise nobody is timing.
 *
 * Neither set leaves both null, and that is a legitimate prescription — "do the movement,
 * tap when you're done". Inventing a default rep count here would put a number the author
 * never wrote in front of whoever is standing at the bar.
 *
 * `load` is display text ("135 lb", "red band", "bodyweight"). Nothing computes with it.
 */
export function makeWorkoutExercise(raw = {}) {
  const reps = toOptionalCount(raw?.reps);
  const seconds = toOptionalCount(raw?.seconds);
  return Object.freeze({
    slug: toText(raw?.slug) ?? '',
    sets: toCount(raw?.sets, 1),
    reps,
    seconds: reps === null ? seconds : null,
    load: toText(raw?.load),
    restSeconds: toCount(raw?.restSeconds, 0),
  });
}

/** Normalize one group: its exercises, and how many times you pass through them. */
export function makeExerciseGroup(raw = {}) {
  const members = Array.isArray(raw?.exercises) ? raw.exercises : [];
  return Object.freeze({
    rounds: toCount(raw?.rounds, 1),
    exercises: Object.freeze(
      members.filter((entry) => entry != null).map((entry) => makeWorkoutExercise(entry)),
    ),
  });
}

/** Normalize a whole workout. `author` is a household member id — workouts are shared. */
export function makeWorkout(raw = {}) {
  const groups = Array.isArray(raw?.groups) ? raw.groups : [];
  return Object.freeze({
    id: toText(raw?.id),
    title: toText(raw?.title),
    author: toText(raw?.author),
    groups: Object.freeze(
      groups.filter((entry) => entry != null).map((entry) => makeExerciseGroup(entry)),
    ),
  });
}

/**
 * What kind of group is this? DERIVED from size — never user-entered.
 *
 * 1 exercise is straight sets, 2 is a superset, 3 or more is a circuit. Asking an author
 * to also label the group would let the label drift from the structure; deriving it means
 * "Superset" appears on the runner exactly when two exercises are actually paired.
 *
 * An empty group is degenerate — it expands to no steps at all — so it reports 'sets'
 * rather than a fourth kind nobody would render.
 *
 * @param {{exercises?: unknown[]}} [group] A normalized or raw group.
 * @returns {'sets'|'superset'|'circuit'}
 */
export function groupKind(group) {
  const count = Array.isArray(group?.exercises) ? group.exercises.length : 0;
  if (count >= 3) return 'circuit';
  if (count === 2) return 'superset';
  return 'sets';
}

/**
 * Flatten an authored workout into the ordered step list the Run player consumes.
 *
 * HOW ROUNDS AND SETS COMPOSE — one rule, all three group shapes:
 *
 *   A group is traversed `rounds` times. Within each traversal, each exercise contributes
 *   `sets` consecutive work steps before the next exercise begins.
 *
 * So `rounds` is the group-level pass counter and `sets` is consecutive work at one
 * station. An exercise is therefore performed `rounds * sets` times in total, which is
 * what a step reports as `totalSets`.
 *
 * That single rule produces exactly the behaviour each shape needs:
 *   - Straight sets (1 exercise, sets 3, rounds 1) -> A A A. With one exercise there is
 *     nothing to alternate with, so consecutive sets is precisely what a person does.
 *   - Superset (2 exercises, sets 1, rounds 3) -> A B A B A B. Alternation is the whole
 *     point of a superset, and it falls out of leaving `sets` at 1 and raising `rounds`.
 *     This is the authoring the builder should produce for a superset.
 *   - Circuit (3 exercises, sets 1, rounds 2) -> A B C A B C.
 *
 * `sets > 1` in a multi-exercise group stays legal and unambiguous rather than being
 * rejected or silently rewritten: a superset with `sets: 2, rounds: 3` is 3 passes of
 * "two sets of A, then two sets of B" — someone finishing at one station before rotating,
 * which is a real thing people do when a machine is contested — for 6 performances of
 * each exercise. It is not 6 alternating passes. An author who wants alternating passes
 * raises `rounds`, which is the knob that means passes.
 *
 * REST — a work step is followed by a rest step whenever the exercise authored
 * `restSeconds > 0`, including between two sets of the same exercise and between groups.
 * Any rest left at the very end is dropped: a workout must not end by telling someone to
 * rest, and the runner would otherwise hold the screen on a countdown after the last rep.
 *
 * Degenerate input yields fewer steps, never an exception: `rounds: 0`, `sets: 0`, an
 * empty group, and a missing workout all simply contribute nothing. A builder mid-edit
 * routinely holds a group with no exercises in it, and previewing that should show an
 * empty plan, not an error.
 *
 * @param {object} [workout] A normalized Workout, or a raw record — it is normalized here.
 * @returns {Array<object>} Work and rest steps in performance order. Not frozen.
 */
export function expandWorkout(workout) {
  const { groups } = makeWorkout(workout);
  const steps = [];

  groups.forEach((group, groupIndex) => {
    const kind = groupKind(group);
    for (let round = 1; round <= group.rounds; round += 1) {
      for (const exercise of group.exercises) {
        for (let set = 1; set <= exercise.sets; set += 1) {
          steps.push({
            kind: 'work',
            groupIndex,
            groupKind: kind,
            slug: exercise.slug,
            round,
            totalRounds: group.rounds,
            set,
            setsPerRound: exercise.sets,
            // Cumulative across rounds — what "Set 2 of 4" on the runner means.
            setNumber: (round - 1) * exercise.sets + set,
            totalSets: group.rounds * exercise.sets,
            reps: exercise.reps,
            seconds: exercise.seconds,
            load: exercise.load,
          });
          if (exercise.restSeconds > 0) {
            steps.push({
              kind: 'rest',
              groupIndex,
              groupKind: kind,
              seconds: exercise.restSeconds,
              afterSlug: exercise.slug,
              nextSlug: null, // filled in below, once the final rest has been dropped
            });
          }
        }
      }
    }
  });

  while (steps.length > 0 && steps[steps.length - 1].kind === 'rest') steps.pop();

  // Second pass: a rest can only name what follows it once the tail is settled.
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    step.index = i;
    step.totalSteps = steps.length;
    if (step.kind === 'rest') step.nextSlug = steps[i + 1]?.slug ?? null;
  }

  return steps;
}
