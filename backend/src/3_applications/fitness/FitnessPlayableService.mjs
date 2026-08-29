// backend/src/3_applications/fitness/FitnessPlayableService.mjs
import { contentImageRef } from '#apps/common/resources/publicResourceRefs.mjs';

/**
 * FitnessPlayableService - Orchestrates playable episode resolution for fitness shows.
 *
 * Combines:
 * - Playable resolution from content adapter
 * - Watch state enrichment via ContentQueryService
 * - Progress classification using FitnessProgressClassifier
 * - Field mapping to API contract (watchProgress, watchSeconds, isWatched, etc.)
 *
 * This keeps the router free of business logic while preserving the
 * fitness-specific classification pipeline.
 */
export class FitnessPlayableService {
  #fitnessConfigService;
  #contentCatalog;
  #createProgressClassifier;
  #logger;
  /**
   * PLEX STRUCTURE CACHE — the course's shape, never the child's progress.
   *
   * Measured 2026-08-25 against the live library: resolving one piano course's
   * playables costs 1.0-1.5s every call, with no warm-up benefit, and the
   * school agenda pays it per learner. A learner with an open program subject
   * took ~1s while one with nothing open answered in 70ms, so the board's whole
   * wait was this call.
   *
   * ONLY the three reads that describe the CONTENT are cached — the episode
   * list and the two container-metadata lookups. `enrichWithWatchState` is
   * deliberately left outside: it is what "has this child finished today's
   * lesson" is computed from, and serving that stale would tell a child they
   * still owe work they have done, or offer a lesson they just finished. The
   * expensive half is the half that barely changes; the half that changes by
   * the minute is cheap and stays live.
   *
   * In-flight requests are shared, not just completed ones: Plex serialises
   * concurrent requests, so four learners resolving the same course at once
   * must become one fetch rather than four queued ones.
   */
  #structureCache = new Map();
  #structureTtlMs;
  #now;

  /**
   * @param {Object} deps
   * @param {import('./FitnessConfigService.mjs').FitnessConfigService} deps.fitnessConfigService
   * @param {Object} deps.contentCatalog - Provider-neutral fitness content capability
   * @param {Function} deps.createProgressClassifier - Factory: (config) => classifier with classify()
   * @param {Object} [deps.logger]
   */
  constructor({
    fitnessConfigService, contentCatalog, createProgressClassifier,
    logger = console, structureTtlMs = null, now = () => Date.now(),
  }) {
    this.#fitnessConfigService = fitnessConfigService;
    this.#contentCatalog = contentCatalog;
    this.#createProgressClassifier = createProgressClassifier;
    this.#logger = logger;
    // Five minutes: a course gains an episode when someone adds one to Plex,
    // which is a human-scale event, and the cost of being a few minutes late
    // to notice is nil. Injectable so tests do not sleep.
    this.#structureTtlMs = Number.isFinite(structureTtlMs) ? structureTtlMs : 5 * 60_000;
    this.#now = now;
  }

  /**
   * Run `produce()` for `key`, reusing a fresh result or an in-flight request.
   *
   * A rejected fetch is evicted rather than cached: a Plex blip must not be
   * remembered for the whole TTL.
   */
  /**
   * A cached value must never be handed out by reference.
   *
   * Callers below MUTATE what they get — `info.labels = parentInfo.labels` is
   * a direct write onto the container info, and the item list is re-mapped in
   * place-ish through classification. Sharing the cached objects would let one
   * request's edits become every later request's starting state, and for a
   * per-learner read that is a cross-learner leak, not just a stale field.
   * Copying an array of small objects costs nothing against a 1s Plex call.
   */
  static #detach(value) {
    if (Array.isArray(value)) return value.map((entry) => (entry && typeof entry === 'object' ? { ...entry } : entry));
    if (value && typeof value === 'object') return { ...value };
    return value;
  }

  #cachedStructure(key, produce) {
    const hit = this.#structureCache.get(key);
    const now = this.#now();
    if (hit && (hit.pending || now - hit.at < this.#structureTtlMs)) {
      return hit.value.then(FitnessPlayableService.#detach);
    }
    const value = Promise.resolve().then(produce);
    const entry = { value, at: now, pending: true };
    this.#structureCache.set(key, entry);
    value.then(
      () => { entry.pending = false; entry.at = this.#now(); },
      () => { this.#structureCache.delete(key); },
    );
    return value.then(FitnessPlayableService.#detach);
  }

  /**
   * Drop cached Plex structure — all of it, or one course.
   *
   * A course occupies THREE keys (`playables:`, `info:`, `item:`), so dropping
   * the compound id alone would leave two thirds of it cached — invalidation
   * that silently half-works is worse than none.
   */
  invalidateStructure(showId = null) {
    if (showId === null) { this.#structureCache.clear(); return; }
    const compoundId = this.#contentCatalog.canonicalize(showId).contentId;
    for (const key of [...this.#structureCache.keys()]) {
      if (key.endsWith(`:${compoundId}`)) this.#structureCache.delete(key);
    }
  }

  /**
   * Resolve playable episodes for a fitness show, enriched with watch state
   * and fitness-specific progress classification.
   *
   * @param {string} showId - Plex show ID, bare ("12345") or already scoped
   *   ("plex:12345"). Both are accepted and normalised to one compound id.
   * @param {string} [householdId] - Household ID for config lookup
   * @returns {Promise<{items: Array, parents: Object|null, container: Object|null}>}
   * @throws {Error} If adapter is missing or doesn't support resolvePlayables
   */
  async getPlayableEpisodes(showId, householdId) {
    if (!this.#contentCatalog) {
      throw new Error('Fitness content adapter not configured');
    }
    if (!this.#contentCatalog.resolvePlayables) {
      throw new Error('Content adapter does not support playable resolution');
    }

    // Callers reach this service from three directions and disagree about the
    // id shape: the Fitness routes pass a bare rating key, the piano kiosk
    // passes the `plex:`-prefixed id its grid renders, and School passes back
    // whatever an enrollment recorded. Prepending unconditionally minted
    // `plex:plex:675689` for the prefixed half — a string that is not a Plex id
    // to anything downstream. It silently voided the two piano rules keyed on
    // `videos.co_progress[].courseId` / `videos.reference_units[].courseId`
    // (both written `plex:675689`, so neither ever matched), and it made the
    // School launch card name a course the image proxy cannot resolve.
    // Normalising HERE, where the compound id is minted, is what lets every
    // caller keep passing the id shape that is natural to it.
    const { localId, contentId: compoundId } = this.#contentCatalog.canonicalize(showId);

    // Load config for progress classification thresholds
    const classifierConfig = this.#fitnessConfigService.getProgressClassification(householdId);
    const classifier = this.#createProgressClassifier
      ? this.#createProgressClassifier(classifierConfig)
      : { classify: () => 'unknown' };

    // Resolve playable items from content adapter
    // Structure only — watch state is enriched fresh below, every call.
    let items = await this.#cachedStructure(
      `playables:${compoundId}`, () => this.#contentCatalog.resolvePlayables(compoundId),
    );

    // Enrich with watch state via ContentQueryService (DDD-compliant)
    items = await this.#contentCatalog.enrichWatchState(items, compoundId);

    // Apply fitness-specific classification and map to API contract
    items = items.map(item => this.#classifyItem(item, classifier));

    // Build parents map from items' hierarchy metadata
    const parents = this.#buildParentsMap(items);

    // Get container info and item for show metadata
    const [info, containerItem] = await Promise.all([
      this.#contentCatalog.getContainerInfo
        ? this.#cachedStructure(`info:${compoundId}`, () => this.#contentCatalog.getContainerInfo(compoundId))
        : null,
      this.#contentCatalog.getItem
        ? this.#cachedStructure(`item:${compoundId}`, () => this.#contentCatalog.getItem(compoundId))
        : null
    ]);

    // Season-as-show: inherit labels from parent show.
    // Plex seasons rarely carry labels of their own; governance/resumable/
    // sequential flags live on the parent show. We fetch the show metadata
    // once and copy its labels onto the season's info so FitnessShow's
    // existing label-driven logic works unchanged.
    if (info?.type === 'season'
        && (!Array.isArray(info.labels) || info.labels.length === 0)
        && info.parentContentId) {
      try {
        const parentInfo = await this.#contentCatalog.getContainerInfo(info.parentContentId);
        if (parentInfo && Array.isArray(parentInfo.labels) && parentInfo.labels.length > 0) {
          info.labels = parentInfo.labels;
        }
      } catch (err) {
        this.#logger.warn?.('fitness.playable.season_label_fetch_failed', {
          seasonId: compoundId,
          parentContentId: info.parentContentId,
          error: err.message
        });
        // Degraded: leave info.labels as-is (empty). User loses governance/
        // resume/sequential gating for this load only — preferable to a 500.
      }
    }

    return {
      compoundId,
      // The bare key, not the caller's spelling: a result whose `showId` still
      // said `plex:675689` next to a `compoundId` of `plex:675689` would invite
      // the next caller to re-prefix it and reintroduce exactly this bug.
      showId: localId,
      items,
      parents,
      info,
      containerItem
    };
  }

  /**
   * List all fitness shows available in the configured fitness library.
   * Returns a simplified catalog suitable for agent content selection.
   *
   * @param {string} [householdId] - Household ID for config lookup
   * @returns {Promise<{shows: Array, libraryId: string|number}>}
   */
  async listFitnessShows(householdId) {
    if (!this.#contentCatalog) {
      throw new Error('Fitness content adapter not configured');
    }

    return this.#contentCatalog.listConfiguredShows();
  }

  /**
   * Classify a single item's watch progress using fitness-specific thresholds.
   *
   * Maps domain fields (playhead, percent, duration) to API contract fields
   * (watchProgress, watchSeconds, watchedDate, isWatched).
   *
   * @param {Object} item - Playable item with watch state
   * @param {Object} classifier - Progress classifier with classify() method
   * @returns {Object} Item with API-contract watch fields
   * @private
   */
  #classifyItem(item, classifier) {
    const playhead = item.playhead ?? 0;
    const percent = item.percent ?? 0;
    const duration = item.duration ?? 0;

    // Ever-completed gate: either the provider recorded a completed play or we
    // stamped completedAt locally when the watched threshold was first crossed.
    // This prevents the sequential-show lock gate from resetting when a user
    // replays an earlier episode (which resets playhead/percent).
    const everCompleted = (item.metadata?.completedPlayCount ?? 0) >= 1
      || !!item.completedAt;

    return {
      ...item,
      watchProgress: percent,
      watchSeconds: playhead,
      watchedDate: item.lastPlayed ?? null,
      isWatched: everCompleted || classifier.classify(
          { playhead, percent, watchTime: item.watchTime },
          { duration }
        ) === 'watched'
    };
  }

  /**
   * Build a parents map from items' hierarchy metadata.
   * Groups items by parent ID and extracts parent info (index, title, thumbnail, type).
   *
   * @param {Array} items - Items with metadata containing parent info
   * @returns {Object|null} Parents map keyed by parentId, or null if no parents found
   * @private
   */
  #buildParentsMap(items) {
    if (items.length === 0) return null;

    const parentsMap = {};
    for (const item of items) {
      const pId = item.metadata?.parentId;
      if (pId && !parentsMap[pId]) {
        const parentRef = this.#contentCatalog.canonicalize(pId);
        parentsMap[pId] = {
          index: item.metadata?.parentIndex,
          title: item.metadata?.parentTitle || 'Parent',
          thumbnail: item.metadata?.parentThumb || contentImageRef(parentRef.source, parentRef.localId),
          type: item.metadata?.parentType
        };
      }
    }

    return Object.keys(parentsMap).length > 0 ? parentsMap : null;
  }
}
