// backend/src/2_domains/exercise/entities.mjs
//
// The shared vocabulary of the exercise-reference corpus.
//
// WHY THIS EXISTS
// ---------------
// Two apps consume the same ~1,287-exercise corpus: a browse/build/run module in
// Fitness and an anatomy shelf in School. Neither owns it. These factories are the
// one place a raw manifest record (see `cli/exerciseLibraryIndex.lib.mjs`) becomes a
// domain object, so both apps see the same field names, the same defaults, and the
// same idea of what "matches a filter" means.
//
// Fitness-only concepts — Workout, supersets, sets/reps/rest — deliberately live in
// `2_domains/fitness/workout/`, not here.
//
// CONTRACTS
// ---------
// - Pure. No I/O, no clock, no randomness, no logging.
// - The FACTORIES never throw on bad input. A defective record still yields a usable
//   object; the index builder already reported the defect as data in `warnings`.
//   `exerciseMatchesFilter` is not covered by that: it states a precondition on its
//   `exercise` argument and throws when handed something that violates it. See its
//   JSDoc for why a throw beats a defensive read there.
// - Every normalized object is FROZEN, arrays included. The adapter loads the
//   manifest once and serves the same objects to every request in both apps; a
//   consumer that sorts an exercise's `groups` in place would corrupt the corpus
//   for everyone. Freezing turns that class of bug into an immediate TypeError
//   at the mutation site instead of an inexplicable one three requests later.
// - Input arrays are COPIED, never aliased, so the raw manifest object can be
//   discarded (or mutated) without reaching back into the domain.

/** Coerce a YAML/JSON scalar to a trimmed string, or null. Objects are not text. */
function toText(value) {
  if (value == null || typeof value === 'object') return null;
  const str = String(value).trim();
  return str === '' ? null : str;
}

/** Copy a scalar-or-sequence field into a frozen array of clean strings. */
function toList(value) {
  if (value == null) return Object.freeze([]);
  const arr = Array.isArray(value) ? value : [value];
  return Object.freeze(
    arr
      .map((v) => toText(v))
      .filter((v) => v !== null),
  );
}

/**
 * Fold a name or query into a comparable form: lowercase, with every run of
 * non-alphanumerics collapsed to a single space.
 *
 * This is what makes `q: 'push up'` find `Push-Up`. The corpus writes names with
 * hyphens, parentheses and slashes ("Assisted Chest Dip (kneeling)") while a person
 * typing into a search box writes spaces. Collapsing separators rather than deleting
 * them keeps the match predictable: "push up" and "PUSH-UP" both hit, "pushup" does
 * not — a word boundary is still a boundary.
 */
function foldForSearch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Normalize one filter facet into the set of slugs that satisfy it.
 *
 * @returns {string[]|null} `null` when the facet imposes no constraint; otherwise the
 *   accepted slugs, lowercased. An EMPTY array is meaningful: it constrains, and
 *   nothing satisfies it.
 *
 * A facet may be a bare scalar (`group: 'chest'`) or a list (`group: ['chest','back']`)
 * because Express's `qs` parser turns `?group=chest&group=back` and `?group[]=chest`
 * into arrays. Both forms must behave the same, and a single-element list must never
 * read as "no constraint" — that would serve the whole 1,287-record corpus in place of
 * a filtered set, with no error anywhere to show for it.
 *
 * Absent, blank, and empty-list all mean "nothing selected" and impose no constraint,
 * so a cleared search box behaves as if it were never touched. A member that is not a
 * scalar (`?group[x]=y`, a nested array) is uninterpretable, and the safe reading of an
 * uninterpretable request is that nothing matches it — never that everything does.
 */
const MATCHES_NOTHING = Object.freeze([]);

function toTerms(value) {
  if (value == null) return null;
  const members = Array.isArray(value) ? value : [value];
  const terms = [];
  for (const member of members) {
    if (member == null) continue;
    if (typeof member === 'object') return MATCHES_NOTHING;
    const term = String(member).trim().toLowerCase();
    if (term !== '') terms.push(term);
  }
  return terms.length === 0 ? null : terms;
}

/** True when `list` holds any of `terms`, comparing slugs case-insensitively. */
function listHasAny(list, terms) {
  return list.some((entry) => terms.includes(entry.toLowerCase()));
}

/**
 * Normalize one raw exercise record from the prebuilt index manifest.
 *
 * `groups` is the DERIVED membership (exercise -> muscle -> that muscle's group) and
 * is the only authority on which group an exercise belongs to. `targetGroups` is the
 * corpus's own hint; it is carried verbatim for auditing and display, and the two
 * genuinely disagree in the live data (hundreds of records hint `core`, for which no
 * muscle-group record exists). Nothing here may ever fall back to the hint.
 */
export function makeExercise(raw = {}) {
  const slug = toText(raw?.slug) ?? '';
  return Object.freeze({
    id: toText(raw?.id),
    slug,
    name: toText(raw?.name) ?? slug,
    description: toText(raw?.description),
    instructions: toList(raw?.instructions),
    imageId: toText(raw?.imageId),
    image: toText(raw?.image),
    stills: toList(raw?.stills),
    video: toText(raw?.video),
    targetMuscles: toList(raw?.targetMuscles),
    targetGroups: toList(raw?.targetGroups),   // HINT ONLY — never used for filtering
    groups: toList(raw?.groups),               // DERIVED — the authoritative membership
    equipment: toList(raw?.equipment),
  });
}

/**
 * Normalize one raw muscle record.
 *
 * `group` is the resolved muscle-group slug, or null when the corpus named a group
 * that has no record. `declaredGroup` preserves what the record claimed in that case
 * and is always present (null when there was nothing to preserve) so a consumer never
 * has to probe for the key. `fullDescription` is the long-form passage School renders
 * as reader content.
 */
export function makeMuscle(raw = {}) {
  const slug = toText(raw?.slug) ?? '';
  return Object.freeze({
    id: toText(raw?.id),
    slug,
    name: toText(raw?.name) ?? slug,
    group: toText(raw?.group),
    declaredGroup: toText(raw?.declaredGroup),
    description: toText(raw?.description),
    fullDescription: toText(raw?.fullDescription),
    imageId: toText(raw?.imageId),
    image: toText(raw?.image),
  });
}

/** Normalize one raw muscle-group record. `muscles` lists member muscle slugs. */
export function makeMuscleGroup(raw = {}) {
  const slug = toText(raw?.slug) ?? '';
  return Object.freeze({
    id: toText(raw?.id),
    slug,
    name: toText(raw?.name) ?? slug,
    description: toText(raw?.description),
    muscles: toList(raw?.muscles),
  });
}

/** Normalize one raw equipment record. */
export function makeEquipment(raw = {}) {
  const slug = toText(raw?.slug) ?? '';
  return Object.freeze({
    id: toText(raw?.id),
    slug,
    name: toText(raw?.name) ?? slug,
    description: toText(raw?.description),
  });
}

/**
 * Does one exercise satisfy a browse filter?
 *
 * @param {object} exercise PRECONDITION: an exercise whose `groups`, `targetMuscles`
 *   and `equipment` are arrays — anything from {@link makeExercise}, or a raw record
 *   straight out of `buildExerciseIndex`, which always emits those three as arrays.
 *   A partial object hand-built by a caller throws a TypeError here. That is
 *   deliberate: reading missing fields defensively would turn a programming error
 *   into a plausible-looking wrong answer served to a user.
 * @param {object} [filter]
 * @param {string|string[]} [filter.group]     Muscle-group slug(s), matched against DERIVED `groups`.
 * @param {string|string[]} [filter.muscle]    Muscle slug(s), matched against `targetMuscles`.
 * @param {string|string[]} [filter.equipment] Equipment slug(s), matched against `equipment`.
 * @param {string} [filter.q]                  Free text, matched against name and slug only.
 * @returns {boolean}
 *
 * Standard faceted-search semantics: OR within a facet, AND across facets. So
 * `{ group: ['chest','back'] }` accepts an exercise in either group, while
 * `{ group: ['chest'], equipment: ['barbell'] }` demands both. A facet that is absent,
 * blank or an empty list imposes no constraint, so an empty filter matches everything
 * and a cleared search box behaves as if it were never touched.
 *
 * `q` deliberately does NOT search `description` or `instructions`. Instruction text
 * is prose ("lower until your thighs are parallel..."), so including it would make
 * short queries match hundreds of unrelated exercises and turn browse into noise.
 */
export function exerciseMatchesFilter(exercise, filter = {}) {
  if (!exercise) return false;

  const groups = toTerms(filter?.group);
  if (groups !== null && !listHasAny(exercise.groups, groups)) return false;

  const muscles = toTerms(filter?.muscle);
  if (muscles !== null && !listHasAny(exercise.targetMuscles, muscles)) return false;

  const equipment = toTerms(filter?.equipment);
  if (equipment !== null && !listHasAny(exercise.equipment, equipment)) return false;

  const q = foldForSearch(filter?.q);
  if (q !== '') {
    const haystack = `${foldForSearch(exercise.name)} ${foldForSearch(exercise.slug)}`;
    if (!haystack.includes(q)) return false;
  }

  return true;
}
