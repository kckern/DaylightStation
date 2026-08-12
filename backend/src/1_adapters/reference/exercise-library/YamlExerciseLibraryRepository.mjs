// backend/src/1_adapters/reference/exercise-library/YamlExerciseLibraryRepository.mjs
//
// The runtime reader for the shared exercise-reference corpus.
//
// WHY THIS EXISTS
// ---------------
// The corpus (~1,296 exercises, 38 muscles, 12 groups, 29 equipment types, ~4,000
// images and 66 videos — 437 MB) lives on a cloud-synced tree whose files are
// online-only placeholders; a single cold read has measured >120s. NOTHING here may
// walk it. `cli/exercise-library.cli.mjs` walks it once, offline, and publishes a
// single manifest; this adapter reads that manifest whole, once, and serves both
// consumers (the Fitness browse/build/run module and the School anatomy shelf) from
// memory.
//
// CONTRACTS
// ---------
// 1. MANIFEST ONLY. The only filesystem calls in this file are `fileExists` and
//    `loadYamlSafe` against `indexPath`. No directory listing, no per-record read,
//    no media stat — media is addressed by URL and streamed by the API layer.
//
// 2. A MISSING OR MALFORMED MANIFEST NEVER BLOCKS BOOT. Nobody may have run the CLI
//    yet, the volume may not be mounted, the file may be half-copied. Every one of
//    those degrades to an empty corpus plus one warning; `meta.available` reports the
//    state so a caller can say "run `exercise-library build`" instead of "no results".
//
// 3. NULL PROTOTYPES ARE RESTORED ON LOAD. The builder keys every slug map with
//    `Object.create(null)` because corpus slugs are third-party strings — the corpus
//    is free to contain `constructor`, `toString` or `__proto__`. That protection does
//    NOT survive serialization: YAML parsing hands back `Object.prototype`-backed
//    objects, so a bare `manifest.byMuscle[slug]` would return an inherited function
//    for `constructor`, and *writing* `map['__proto__'] = record` into a plain object
//    would not even create an own property — the record would vanish. Every slug-keyed
//    map is therefore rebuilt on a null prototype, and THAT is the guard: accessors
//    read `map[slug] ?? null` directly and deliberately carry no second `Object.hasOwn`
//    check, so that dropping the restore fails a test instead of being masked.
//
// 4. FILTERING BELONGS TO THE DOMAIN. `findExercises` hands the caller's filter object
//    to `exerciseMatchesFilter` untouched — no stringifying, no flattening, no
//    re-normalizing. A facet may be a scalar or a list (Express's `qs` produces both
//    from `?group=chest&group=back`), and the domain already implements OR-within-facet
//    / AND-across-facets. Re-deriving any of that here would be a second, drifting
//    implementation of the corpus's search semantics.
//
// ORDERING
// --------
// Every list is returned in manifest order, which the builder guarantees is sorted by
// slug. This adapter never re-sorts; a caller wanting another order sorts its own copy.
//
// PERFORMANCE
// -----------
// The manifest is ~2.8 MB and is parsed exactly once, on first use. `findExercises`
// then scans 1,296 pre-normalized, pre-frozen domain objects — no parsing, no I/O, no
// allocation beyond the result array. The long-form anatomy essays are a Muscle field
// (`fullDescription`), so the browse path never touches them and there is nothing to
// gain by holding them separately.

import {
  fileExists,
  loadYamlSafe,
} from '#system/utils/FileIO.mjs';
import {
  makeExercise,
  makeMuscle,
  makeMuscleGroup,
  makeEquipment,
  exerciseMatchesFilter,
} from '#domains/exercise/index.mjs';

/**
 * Manifest schema this adapter was written against. A mismatch is reported and then
 * ignored: the manifest has only ever grown, and refusing to serve a corpus over a
 * version bump would take the whole shelf offline for a change that is usually additive.
 * `meta.version` carries the manifest's own claim so a caller can decide otherwise.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * URL prefix for corpus-relative media paths.
 *
 * The manifest stores paths relative to the corpus root (`assets/<uuid>.gif`,
 * `exercises/<slug>_1.png`, `hevy_videos/<name>.mp4`). The corpus root is
 * `<mediaDir>/library/exercise`, and `/media/**` is what the frontend's
 * `DaylightMediaPath()` rewrites to `/api/v1/proxy/media/**` — the route that streams
 * any file under the media root. So the default prefix produces exactly what the
 * frontend already knows how to fetch, with no host or port baked in. A composition
 * root that wants absolute API paths can pass `mediaBase: '/api/v1/proxy/media/library/exercise'`
 * instead; this adapter only ever joins.
 */
export const DEFAULT_MEDIA_BASE = 'media/library/exercise';

/** The slug-keyed maps whose null prototype the builder guarantees and serialization loses. */
const RECORD_MAPS = ['exercises', 'muscles', 'muscleGroups', 'equipment'];
const BUCKET_MAPS = ['byGroup', 'byMuscle', 'byEquipment'];

/**
 * Facet name -> the inverted index that answers it.
 *
 * Null-prototype for the same reason the slug maps are: the facet name reaches this
 * table straight from a query string, and a plain object literal would answer
 * `BUCKET_FOR_FACET['constructor']` with a function.
 */
const BUCKET_FOR_FACET = Object.assign(Object.create(null), {
  group: 'byGroup',
  muscle: 'byMuscle',
  equipment: 'byEquipment',
});

/** A YAML mapping — not a sequence, not a scalar, not null. */
function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Copy a parsed mapping onto a fresh null-prototype object.
 *
 * This is the single point where contract 3 is honoured. `Object.keys` sees own
 * enumerable properties only, so nothing inherited is dragged along, and the target's
 * missing prototype means a key of `__proto__` lands as an ordinary own property
 * instead of reassigning the map's own prototype.
 */
function toNullPrototypeMap(raw) {
  const out = Object.create(null);
  if (!isMapping(raw)) return out;
  for (const key of Object.keys(raw)) out[key] = raw[key];
  return out;
}

/** Normalize an inverted-index bucket to a frozen array of slug strings. */
function toSlugList(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.filter((slug) => typeof slug === 'string' && slug.trim() !== ''));
}

/** Coerce a scalar-or-sequence manifest field to an array, without dropping anything. */
function toArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Read-only, in-memory projection of the exercise-reference corpus.
 *
 * @example
 *   const library = new YamlExerciseLibraryRepository({
 *     indexPath: path.join(configService.getDataDir(), 'household/apps/fitness/exercise-index.yml'),
 *     logger,
 *   });
 *   library.findExercises({ group: ['chest', 'back'], equipment: 'barbell', q: 'press' });
 */
export class YamlExerciseLibraryRepository {
  #indexPath;
  #mediaBase;
  #logger;
  /** Null until the first `load()`; an object (possibly empty) forever after. */
  #corpus = null;

  /**
   * @param {Object} deps
   * @param {string} deps.indexPath Absolute path to the manifest written by
   *   `exercise-library build`. A missing or unreadable file is a degraded state, not
   *   an error — see contract 2.
   * @param {string} [deps.mediaBase] URL prefix for corpus-relative media paths.
   * @param {Object} [deps.logger] Anything with `warn`/`info`. Defaults to `console`,
   *   matching every sibling adapter.
   */
  constructor({ indexPath, mediaBase = DEFAULT_MEDIA_BASE, logger = console } = {}) {
    this.#indexPath = typeof indexPath === 'string' && indexPath.trim() !== ''
      ? indexPath.trim()
      : null;
    const base = typeof mediaBase === 'string' && mediaBase.trim() !== ''
      ? mediaBase.trim()
      : DEFAULT_MEDIA_BASE;
    this.#mediaBase = base.replace(/\/+$/, '');
    this.#logger = logger ?? console;
  }

  // -- loading --------------------------------------------------------------

  /**
   * Parse the manifest into memory. Idempotent and non-throwing: the first call does
   * the work, every later call is a no-op, and any failure yields an empty corpus.
   *
   * Callers do not have to invoke this — every read method loads on demand — but the
   * composition root should, so the ~2.8 MB parse happens at boot rather than inside
   * the first request.
   *
   * @returns {this}
   */
  load() {
    if (this.#corpus) return this;
    this.#corpus = this.#buildCorpus(this.#readManifest());
    return this;
  }

  /** @returns {Object|null} the raw manifest mapping, or null in every degraded case. */
  #readManifest() {
    if (!this.#indexPath) {
      this.#logger.warn?.('exercise-library.manifest.unconfigured', {
        reason: 'no indexPath supplied; serving an empty corpus',
      });
      return null;
    }
    if (!fileExists(this.#indexPath)) {
      this.#logger.warn?.('exercise-library.manifest.missing', {
        indexPath: this.#indexPath,
        reason: 'run `exercise-library build`; serving an empty corpus',
      });
      return null;
    }
    // `loadYamlSafe` returns null rather than throwing on a truncated or otherwise
    // unparseable document, which is exactly the boot-safety contract this adapter needs.
    const raw = loadYamlSafe(this.#indexPath);
    if (raw === null || raw === undefined) {
      this.#logger.warn?.('exercise-library.manifest.unreadable', {
        indexPath: this.#indexPath,
        reason: 'file exists but did not parse; serving an empty corpus',
      });
      return null;
    }
    if (!isMapping(raw)) {
      this.#logger.warn?.('exercise-library.manifest.malformed', {
        indexPath: this.#indexPath,
        type: Array.isArray(raw) ? 'sequence' : typeof raw,
        reason: 'manifest root is not a mapping; serving an empty corpus',
      });
      return null;
    }
    if (raw.version !== undefined && raw.version !== SUPPORTED_SCHEMA_VERSION) {
      this.#logger.warn?.('exercise-library.manifest.version', {
        indexPath: this.#indexPath,
        found: raw.version,
        supported: SUPPORTED_SCHEMA_VERSION,
        reason: 'serving anyway; manifest changes have so far been additive',
      });
    }
    return raw;
  }

  /**
   * Turn a raw manifest (or `null`) into the cached corpus.
   *
   * Every map is rebuilt on a null prototype (contract 3) and every record is put
   * through the domain factories, so nothing downstream ever sees a raw manifest
   * record, a snake_case field, or a mutable array.
   */
  #buildCorpus(raw) {
    const source = raw ?? Object.create(null);

    const records = Object.create(null);
    for (const name of RECORD_MAPS) records[name] = toNullPrototypeMap(source[name]);
    const buckets = Object.create(null);
    for (const name of BUCKET_MAPS) {
      const restored = toNullPrototypeMap(source[name]);
      for (const key of Object.keys(restored)) restored[key] = toSlugList(restored[key]);
      buckets[name] = restored;
    }

    const exercises = this.#hydrate(records.exercises, makeExercise, (record) => ({
      image: this.#mediaUrl(record.image),
      stills: toArray(record.stills).map((still) => this.#mediaUrl(still)),
      video: this.#mediaUrl(record.video),
    }));
    const muscles = this.#hydrate(records.muscles, makeMuscle, (record) => ({
      image: this.#mediaUrl(record.image),
    }));
    const muscleGroups = this.#hydrate(records.muscleGroups, makeMuscleGroup);
    const equipment = this.#hydrate(records.equipment, makeEquipment);

    const meta = Object.freeze({
      available: raw !== null,
      indexPath: this.#indexPath,
      mediaBase: this.#mediaBase,
      builtAt: typeof source.builtAt === 'string' ? source.builtAt : null,
      version: typeof source.version === 'number' ? source.version : null,
      assetsResolved: source.assetsResolved === true,
      warningCount: Array.isArray(source.warnings) ? source.warnings.length : 0,
      counts: Object.freeze({
        exercises: exercises.list.length,
        muscles: muscles.list.length,
        muscleGroups: muscleGroups.list.length,
        equipment: equipment.list.length,
      }),
    });

    if (raw !== null) {
      this.#logger.info?.('exercise-library.loaded', {
        indexPath: this.#indexPath,
        builtAt: meta.builtAt,
        ...meta.counts,
        warnings: meta.warningCount,
      });
    }

    return {
      exercises: exercises.map,
      muscles: muscles.map,
      muscleGroups: muscleGroups.map,
      equipment: equipment.map,
      exerciseList: exercises.list,
      muscleList: muscles.list,
      groupList: muscleGroups.list,
      equipmentList: equipment.list,
      buckets,
      meta,
    };
  }

  /**
   * Turn one restored slug map into `{ map, list }` of frozen domain objects.
   *
   * The map key — not the record's own `slug` field — decides identity. Every
   * cross-reference in the corpus is written against paths, the builder keys the
   * manifest by filename, and it reports a `slug-mismatch` warning when a record body
   * disagrees. Honouring the body instead would hand back an object whose `slug` no
   * longer addresses it: a detail link that 404s on the very record it was rendered from.
   *
   * Entries that are not mappings (`slug: null`, a stray sequence) are dropped rather
   * than turned into an entity with an empty name — the manifest is third-party output
   * and a half-written entry is not content.
   *
   * @param {Object} rawMap null-prototype slug -> raw record
   * @param {Function} factory the domain factory for this collection
   * @param {Function} [decorate] extra fields to overlay, typically resolved media URLs
   */
  #hydrate(rawMap, factory, decorate = null) {
    const map = Object.create(null);
    const list = [];
    for (const slug of Object.keys(rawMap)) {
      const record = rawMap[slug];
      if (!isMapping(record)) continue;
      const entity = factory({ ...record, slug, ...(decorate ? decorate(record) : null) });
      map[slug] = entity;
      list.push(entity);
    }
    return { map, list: Object.freeze(list) };
  }

  /**
   * Corpus-relative media path -> URL the frontend can fetch.
   *
   * `null` in means `null` out, and so does a manifest that recorded no asset. The
   * builder deliberately writes `image: null` when an image uuid resolved to no file
   * on disk (rather than fabricating `assets/<uuid>.gif`), so that a non-null path
   * means a real file; fabricating one here would throw that distinction away and put
   * a broken `<img>` in front of the user for every content gap.
   *
   * Each segment is percent-encoded. Corpus filenames carry parentheses and mixed case
   * ("Barbell-Standing-Military-Press-(without-rack)_Shoulders.mp4"), and Express 5
   * decodes wildcard segments exactly once before the media route sees them, so
   * encoding here round-trips precisely — including the pathological literal `%`.
   */
  #mediaUrl(relativePath) {
    if (relativePath == null || typeof relativePath === 'object') return null;
    const trimmed = String(relativePath).trim().replace(/^\/+/, '');
    if (trimmed === '') return null;
    const encoded = trimmed.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    return `${this.#mediaBase}/${encoded}`;
  }

  // -- reads ----------------------------------------------------------------

  /**
   * Load state and corpus counts. The one thing a caller can use to tell "the corpus
   * is empty because nobody built the manifest" from "your filter matched nothing".
   * @returns {{available: boolean, indexPath: string|null, mediaBase: string,
   *   builtAt: string|null, version: number|null, assetsResolved: boolean,
   *   warningCount: number, counts: {exercises: number, muscles: number,
   *   muscleGroups: number, equipment: number}}}
   */
  get meta() {
    return this.load().#corpus.meta;
  }

  /** @returns {Array<object>} every muscle group, in manifest order. */
  listGroups() {
    // A fresh array per call: the cached list is shared by both apps and every request,
    // and a caller that sorted or spliced the returned array in place would corrupt the
    // corpus for everyone. (The domain objects inside it are frozen already.)
    return this.load().#corpus.groupList.slice();
  }

  /** @returns {Array<object>} every muscle, in manifest order. Includes `fullDescription`. */
  listMuscles() {
    return this.load().#corpus.muscleList.slice();
  }

  /** @returns {Array<object>} every equipment type, in manifest order. */
  listEquipment() {
    return this.load().#corpus.equipmentList.slice();
  }

  /**
   * Exercises satisfying a browse filter, in manifest order.
   *
   * @param {Object} [filter]
   * @param {string|string[]} [filter.group]     muscle-group slug(s), matched against DERIVED `groups`
   * @param {string|string[]} [filter.muscle]    muscle slug(s)
   * @param {string|string[]} [filter.equipment] equipment slug(s)
   * @param {string} [filter.q]                  free text over name and slug
   * @returns {Array<object>} OR within a facet, AND across facets. An empty or absent
   *   filter returns the whole corpus.
   *
   * The filter is passed to the domain VERBATIM — see contract 4. A linear scan over
   * 1,296 frozen objects costs well under a millisecond; the manifest's inverted indexes
   * could narrow the candidate set first, but only by re-deriving the domain's facet
   * normalization here, which is the one thing this method must not do.
   */
  findExercises(filter = {}) {
    return this.load().#corpus.exerciseList
      .filter((exercise) => exerciseMatchesFilter(exercise, filter));
  }

  /**
   * @param {string} slug
   * @returns {object|null} the exercise, or null. Safe for hostile slugs — see contract 3.
   */
  getExercise(slug) {
    if (typeof slug !== 'string') return null;
    return this.load().#corpus.exercises[slug] ?? null;
  }

  /**
   * @param {string} slug
   * @returns {object|null} the muscle (with `fullDescription`, which is what School
   *   renders as reader content), or null. Safe for hostile slugs.
   */
  getMuscle(slug) {
    if (typeof slug !== 'string') return null;
    return this.load().#corpus.muscles[slug] ?? null;
  }

  /**
   * The manifest's inverted indexes, read safely.
   *
   * Cheap enough to answer facet counts and "what else targets this muscle?" without
   * materializing exercises — which is how the School shelf lists a muscle's examples
   * and how the browse rail sizes its chips.
   *
   * @param {'group'|'muscle'|'equipment'} facet
   * @param {string} slug
   * @returns {string[]} exercise slugs, sorted by the builder. Empty for an unknown
   *   facet or slug — including `constructor` and `toString`.
   */
  listExerciseSlugsBy(facet, slug) {
    const bucketName = BUCKET_FOR_FACET[facet];
    if (!bucketName || typeof slug !== 'string') return [];
    return (this.load().#corpus.buckets[bucketName][slug] ?? []).slice();
  }
}

export default YamlExerciseLibraryRepository;
