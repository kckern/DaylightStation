// backend/src/3_applications/fitness/usecases/BrowseExerciseLibrary.mjs
//
// The read path for the shared exercise corpus: browse a grid, read the facet rails,
// open one exercise.
//
// WHY THIS EXISTS
// ---------------
// Three things have to happen between a query string and a browse screen, and none of
// them belong in a request handler or in the adapter:
//
//   1. Choosing which query params are FACETS (everything else — `household`, cache
//      busters, whatever a client appends — is not a filter and must not become one).
//   2. Choosing how much of a record the wire carries. The corpus is 2.29 MB of JSON as
//      full records; the fields a card actually draws are 0.28 MB of it. See PROJECTION.
//   3. Reporting the degraded state, so a browse screen that shows nothing can say WHY.
//
// WHAT THIS MUST NOT DO
// ---------------------
// It must not interpret the facet VALUES. `2_domains/exercise/entities.mjs` owns filter
// semantics — OR within a facet, AND across facets, and the reading of a malformed term.
// A facet arrives from Express's `qs` parser as a scalar (`?group=chest`), an array
// (`?group=chest&group=back`, `?group[]=chest`) or an object (`?group[x]=y`), and the
// domain already answers all three correctly. So the values are passed through BY
// REFERENCE, untouched.
//
// Two rewrites in particular look harmless and are not:
//
//   - `String(value)` folds `['chest','back']` into the single term `'chest,back'`,
//     which matches no exercise. A browse screen with two chips lit shows an empty grid.
//   - Dropping a value that is not a string ("it's malformed, so ignore the facet")
//     turns a constraint into NO constraint, and the endpoint answers a nonsense query
//     with all 1,296 records. No throw, no log — just a wrong answer that looks like a
//     right one. The domain deliberately reads an uninterpretable facet as matching
//     nothing; keeping the value intact is what preserves that.
//
// PROJECTION
// ----------
// `listExercises` returns SUMMARIES. Instruction prose and long descriptions average
// ~1.6 KB per record, so shipping full bodies costs 2.29 MB on every keystroke of a
// search box to draw a grid of images and names — 8.2x the 0.28 MB the cards need.
// `getExercise` returns the FULL record, because that is the one screen that renders
// instructions, stills and video.
//
// The muscle taxonomy is projected the same way and for the same reason: `fullDescription`
// is the long-form anatomy essay (86 KB across 38 muscles) that the School shelf renders
// as reader content. A filter rail draws a name and a chip, so the essays stay out of it.

/**
 * The query params that are facets. Anything else in the query string is ignored rather
 * than forwarded, so a stray param can never be mistaken for a constraint.
 *
 * `q` is free text over name and slug; the other three are slug facets.
 */
export const FACET_PARAMS = Object.freeze(['group', 'muscle', 'equipment', 'q']);

/**
 * Pull the facets out of a query object.
 *
 * Keys are SELECTED; values are copied by reference and never inspected, coerced or
 * normalized — see WHAT THIS MUST NOT DO. A facet the caller did not send is left absent
 * rather than set to undefined, so the filter object states exactly what was asked for.
 *
 * @param {Object} [query] typically `req.query`
 * @returns {Object} a filter for the domain
 */
export function pickFacets(query = {}) {
  const filter = {};
  if (!query || typeof query !== 'object') return filter;
  for (const param of FACET_PARAMS) {
    // Own-property check: the query object may be prototype-backed, and
    // `query.constructor` is a function, not a facet the caller sent.
    if (Object.hasOwn(query, param)) filter[param] = query[param];
  }
  return filter;
}

/** What a browse card draws, and nothing else. See PROJECTION. */
function toExerciseSummary(exercise) {
  return {
    slug: exercise.slug,
    name: exercise.name,
    image: exercise.image,
    groups: exercise.groups,
    targetMuscles: exercise.targetMuscles,
    equipment: exercise.equipment,
  };
}

/** A muscle as a filter rail needs it: no long-form essay. See PROJECTION. */
function toMuscleSummary(muscle) {
  return {
    slug: muscle.slug,
    name: muscle.name,
    group: muscle.group,
    description: muscle.description,
    image: muscle.image,
  };
}

/** How a caller is told to fix an unbuilt corpus. */
const BUILD_HINT = 'Exercise index not built. Run `npm run exercise:index`.';

export class BrowseExerciseLibrary {
  #library;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.exerciseLibrary The exercise library repository. Needs
   *   `findExercises`, `getExercise`, `listGroups`, `listMuscles`, `listEquipment`
   *   and `meta`. Injected rather than constructed: this layer may not import an
   *   adapter, and the composition root already holds the one loaded instance —
   *   a second would re-parse 2.8 MB of YAML and hold the corpus twice.
   * @param {Object} [deps.logger]
   */
  constructor({ exerciseLibrary, logger = console } = {}) {
    if (!exerciseLibrary) throw new Error('BrowseExerciseLibrary requires exerciseLibrary');
    this.#library = exerciseLibrary;
    this.#logger = logger ?? console;
  }

  /**
   * {@link pickFacets}, reachable from an injected instance.
   *
   * An INSTANCE method rather than a static or a bare import so a request handler can
   * reach the facet policy through the dependency it was already given. The API layer
   * is not supposed to import the application layer at all (`api-no-apps`), and adding
   * an import to read one helper off a class would widen that debt to buy nothing.
   *
   * @param {Object} [query] typically `req.query`
   * @returns {Object} a filter for the domain
   */
  filterFromQuery(query = {}) {
    return pickFacets(query);
  }

  /**
   * Corpus load state, for a caller that has to explain an empty screen.
   *
   * `indexPath` is deliberately NOT included: it is an absolute path on the server's
   * disk and this payload goes to a browser.
   *
   * @returns {{available: boolean, builtAt: string|null, counts: Object, hint?: string}}
   */
  libraryStatus() {
    const meta = this.#library.meta ?? {};
    const status = {
      available: meta.available === true,
      builtAt: meta.builtAt ?? null,
      counts: meta.counts ?? {},
    };
    // The hint is the whole point of reporting this: "no exercises" and "nobody has
    // built the index" look identical on a browse screen, and only one of them is
    // something the person looking at it can fix.
    if (!status.available) status.hint = BUILD_HINT;
    return status;
  }

  /**
   * Exercises matching a browse filter, as summaries.
   *
   * @param {Object} [filter] `{ group, muscle, equipment, q }`; each value may be a
   *   scalar or a list, and is handed to the domain verbatim.
   * @returns {{exercises: Array<Object>, total: number, library: Object}} `total` is the
   *   number of matches, which equals `exercises.length` — it is stated because a caller
   *   rendering "157 of 1,296" should not have to know that.
   */
  listExercises(filter = {}) {
    const matches = this.#library.findExercises(filter);
    const library = this.libraryStatus();
    this.#logger.debug?.('fitness.exercises.browse', {
      facets: Object.keys(filter),
      matched: matches.length,
      corpus: library.counts?.exercises ?? 0,
    });
    return {
      exercises: matches.map(toExerciseSummary),
      total: matches.length,
      library,
    };
  }

  /**
   * Every facet value a browse rail can offer, in manifest (slug) order.
   *
   * All three lists in one response on purpose: a browse screen needs all of them before
   * it can draw its rails, and three round trips to build one sidebar is three chances
   * for it to render half-filtered.
   *
   * @returns {{groups: Array<Object>, muscles: Array<Object>, equipment: Array<Object>,
   *   library: Object}}
   */
  taxonomy() {
    return {
      groups: this.#library.listGroups(),
      muscles: this.#library.listMuscles().map(toMuscleSummary),
      equipment: this.#library.listEquipment(),
      library: this.libraryStatus(),
    };
  }

  /**
   * One exercise, in full — instructions, stills and video included.
   *
   * @param {string} slug
   * @returns {Object|null} null for an unknown slug, including a hostile one; the
   *   repository's slug maps are null-prototyped, so `constructor` is simply unknown.
   */
  getExercise(slug) {
    return this.#library.getExercise(slug);
  }
}

export default BrowseExerciseLibrary;
