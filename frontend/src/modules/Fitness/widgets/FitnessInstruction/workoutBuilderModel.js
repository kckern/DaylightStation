/**
 * Build — pure model helpers for turning the tray Browse handed over into a
 * workout Run can walk. Split out of WorkoutBuilder.jsx (which keeps only the
 * components) so Fast Refresh can hot-reload the UI without a full remount.
 *
 * THE MODEL, AND THE ONE RULE ABOUT IT
 * ------------------------------------
 * A workout is groups; a group is `rounds` passes over its exercises; an exercise
 * contributes `sets` consecutive work steps per pass. That is `expandWorkout`'s rule
 * (backend/src/2_domains/fitness/workout/workout.mjs) and this screen is built so the
 * natural gesture produces the structure that rule wants:
 *
 *   - One exercise in a group is STRAIGHT SETS, so the group exposes a per-exercise
 *     "Sets" stepper and its `rounds` stays 1 -> A A A.
 *   - Two or more is a SUPERSET / CIRCUIT, so the group exposes a group-level "Rounds"
 *     stepper and every member's `sets` is pinned to 1 -> A B A B A B.
 *
 * Nobody is ever asked "sets or rounds?". Merging two 3-set singles into a superset
 * carries the 3 across as 3 rounds (see `mergeGroups`) and splitting it hands each
 * exercise its 3 sets back, so the number of times you actually do the movement
 * survives the gesture in both directions. `sets > 1` inside a multi-exercise group
 * stays legal in the domain — someone finishing both sets at a contested machine before
 * rotating — but it is not offered here: it is the one authoring that the group kind
 * label cannot describe, and this screen is used standing up.
 *
 * The kind itself is DERIVED from member count and only ever displayed. See
 * `groupKind` in GroupEditor.jsx.
 */

export const WORKOUTS_PATH = 'api/v1/fitness/workouts';

/**
 * Where a plan is turned into a run. The server expands the authored groups into the
 * runner's ordered step list and joins each slug against the exercise corpus; see the
 * round-trip note in WorkoutBuilder.jsx's docblock.
 */
export const RUN_PATH = 'api/v1/fitness/workouts/run';

/** Authoring defaults. Straight sets of 10 with a minute's rest is the common case. */
export const DEFAULT_SETS = 3;
export const DEFAULT_REPS = 10;
export const DEFAULT_SECONDS = 30;
export const DEFAULT_REST = 60;

let keySeed = 0;
/** Stable React/reorder identity. Slugs cannot serve: a plan may repeat an exercise. */
function nextKey(prefix) {
  keySeed += 1;
  return `${prefix}${keySeed}`;
}

/** "Workout · Aug 11" — a saveable title with nothing typed. The kiosk has no keyboard. */
export function defaultWorkoutTitle(date = new Date()) {
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `Workout · ${month} ${date.getDate()}`;
}

/** Clamp to a whole number inside [min, max]. */
export function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** One authored exercise row, seeded from a corpus record. */
export function makeMember(exercise = {}) {
  return {
    key: nextKey('m'),
    slug: typeof exercise.slug === 'string' ? exercise.slug.trim() : '',
    name: typeof exercise.name === 'string' && exercise.name.trim() ? exercise.name.trim() : null,
    image: typeof exercise.image === 'string' && exercise.image.trim() ? exercise.image.trim() : null,
    sets: DEFAULT_SETS,
    mode: 'reps', // 'reps' | 'time'
    reps: DEFAULT_REPS,
    seconds: DEFAULT_SECONDS,
    loadLb: 0,
    restSeconds: DEFAULT_REST
  };
}

/** A new straight-sets group holding one exercise. */
export function makeGroup(exercise) {
  return { key: nextKey('g'), rounds: 1, exercises: [makeMember(exercise)] };
}

/**
 * How many times this group is passed through, whichever knob is currently showing.
 *
 * A single-exercise group counts its passes in the member's `sets` (rounds is pinned at
 * 1); a multi-exercise group counts them in `rounds` (member sets are pinned at 1).
 * Merge and split both read this so the work survives the gesture.
 */
export function effectivePasses(group) {
  const members = Array.isArray(group?.exercises) ? group.exercises : [];
  if (members.length === 1) return clamp(members[0]?.sets ?? 1, 1, 99);
  return clamp(group?.rounds ?? 1, 1, 99);
}

/**
 * Fold group `index + 1` into group `index`.
 *
 * The merged group is a superset/circuit, so every member drops to `sets: 1` and the
 * passes move to `rounds` — the authoring `expandWorkout`'s docblock asks for, and the
 * only one that alternates (A B A B) rather than blocking (A A B B). Passes are the
 * larger of the two groups' so nothing silently loses work.
 */
export function mergeGroups(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  const a = list[index];
  const b = list[index + 1];
  if (!a || !b) return list;
  const merged = {
    key: a.key,
    rounds: Math.max(effectivePasses(a), effectivePasses(b)),
    exercises: [...a.exercises, ...b.exercises].map((m) => ({ ...m, sets: 1 }))
  };
  return [...list.slice(0, index), merged, ...list.slice(index + 2)];
}

/**
 * Break a group into one straight-sets group per exercise, each keeping the work it was
 * doing: the group's rounds become each member's sets. Inverse of `mergeGroups`.
 */
export function splitGroup(groups, index) {
  const list = Array.isArray(groups) ? groups : [];
  const group = list[index];
  if (!group || group.exercises.length < 2) return list;
  const passes = effectivePasses(group);
  const singles = group.exercises.map((m, i) => ({
    key: i === 0 ? group.key : nextKey('g'),
    rounds: 1,
    exercises: [{ ...m, sets: passes }]
  }));
  return [...list.slice(0, index), ...singles, ...list.slice(index + 1)];
}

/**
 * Move one item by `delta`. Out-of-range is a no-op returning the SAME array — the
 * caller uses identity to tell "nothing moved" from "moved", so an up-tap on the first
 * group neither reorders nor logs a reorder that did not happen.
 */
export function moveItem(list, index, delta) {
  const arr = Array.isArray(list) ? list : [];
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

/** "135 lb" for display and for the domain's `load` text; 0 means unloaded. */
export function loadLabel(loadLb) {
  const n = Number(loadLb);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)} lb` : null;
}

/**
 * The wire shape: exactly the domain's Workout / ExerciseGroup / WorkoutExercise, with
 * the editor's presentation state (keys, display names, the unused half of the
 * reps/seconds toggle) dropped. An entry is counted or timed, never both — the domain
 * resolves a record carrying both to reps, so sending both would silently discard the
 * timed intent the user set.
 */
export function toPayload({ id = null, title = null, groups = [] } = {}) {
  const payload = {
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    groups: (Array.isArray(groups) ? groups : []).map((group) => ({
      rounds: clamp(group.rounds, 1, 99),
      exercises: (group.exercises || []).map((m) => ({
        slug: m.slug,
        sets: clamp(m.sets, 0, 99),
        reps: m.mode === 'reps' ? clamp(m.reps, 1, 999) : null,
        seconds: m.mode === 'time' ? clamp(m.seconds, 1, 3600) : null,
        load: loadLabel(m.loadLb),
        restSeconds: clamp(m.restSeconds, 0, 3600)
      }))
    }))
  };
  if (id) payload.id = id;
  return payload;
}

/**
 * Work steps the plan expands to.
 *
 * `expandWorkout` traverses a group `rounds` times and each exercise contributes `sets`
 * steps per traversal, so this is `rounds * Σ sets` per group — the same arithmetic, not
 * a UI-flavoured approximation of it. Rest steps are not counted: this is the "how much
 * work is this" number on the header, and rest is not work.
 */
export function totalWorkSteps(groups = []) {
  return (Array.isArray(groups) ? groups : []).reduce((sum, g) => {
    const perPass = (g.exercises || []).reduce((s, m) => s + clamp(m.sets, 0, 99), 0);
    return sum + clamp(g.rounds, 1, 99) * perPass;
  }, 0);
}

/**
 * Pull the server's rejection out of whatever DaylightAPI threw.
 *
 * `DaylightAPI` does not surface the parsed body — it throws
 * `HTTP 400: Bad Request - {"error":"…","unknownSlugs":["…"]}`, the JSON stringified onto
 * the end of a message. The 400 that matters here NAMES the exercises that do not exist,
 * and showing "HTTP 400: Bad Request" instead of those names would send someone hunting
 * through a plan they cannot see the fault in. So the tail is parsed back out; a message
 * with no JSON tail (a 503, a network drop) degrades to the raw text and no slug list.
 */
export function parseSaveError(err) {
  const message = err?.message ?? String(err ?? 'save failed');
  const start = message.indexOf('{');
  if (start !== -1) {
    try {
      const body = JSON.parse(message.slice(start));
      const slugs = Array.isArray(body?.unknownSlugs) ? body.unknownSlugs.filter(Boolean) : [];
      return {
        message: typeof body?.error === 'string' && body.error ? body.error : message,
        unknownSlugs: slugs,
        issues: Array.isArray(body?.issues) ? body.issues : []
      };
    } catch (_) { /* not a JSON tail — fall through to the raw message */ }
  }
  return { message, unknownSlugs: [], issues: [] };
}

/**
 * Turn the server's `slug -> { name, image }` lookup into the display records the
 * container indexes for the runner.
 *
 * `fallbacks` are the plan's own member rows, carrying the name and image Browse showed
 * when the exercise was picked. They fill in any slug the corpus no longer resolves (the
 * server reports those in `missingSlugs`): the corpus can be rebuilt between picking an
 * exercise and running it, and showing the name the user chose beats showing a humanised
 * slug. The server's answer always wins where it has one.
 */
export function toDisplayList(lookup, fallbacks = []) {
  const out = [];
  const seen = new Set();
  const entries = lookup && typeof lookup === 'object' ? Object.entries(lookup) : [];
  entries.forEach(([slug, record]) => {
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push({ slug, name: record?.name ?? null, image: record?.image ?? null });
  });
  (Array.isArray(fallbacks) ? fallbacks : []).forEach((member) => {
    if (!member?.slug || seen.has(member.slug)) return;
    seen.add(member.slug);
    out.push({ slug: member.slug, name: member.name ?? null, image: member.image ?? null });
  });
  return out;
}
