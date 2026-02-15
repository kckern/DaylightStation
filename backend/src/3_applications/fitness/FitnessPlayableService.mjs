// backend/src/3_applications/fitness/FitnessPlayableService.mjs

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
  #contentAdapter;
  #contentQueryService;
  #createProgressClassifier;
  #logger;

  /**
   * @param {Object} deps
   * @param {import('./FitnessConfigService.mjs').FitnessConfigService} deps.fitnessConfigService
   * @param {Object} deps.contentAdapter - Pre-resolved content adapter for fitness (e.g., plex)
   * @param {Object} [deps.contentQueryService] - ContentQueryService for watch state enrichment
   * @param {Function} deps.createProgressClassifier - Factory: (config) => classifier with classify()
   * @param {Object} [deps.logger]
   */
  constructor({ fitnessConfigService, contentAdapter, contentQueryService, createProgressClassifier, logger = console }) {
    this.#fitnessConfigService = fitnessConfigService;
    this.#contentAdapter = contentAdapter;
    this.#contentQueryService = contentQueryService;
    this.#createProgressClassifier = createProgressClassifier;
    this.#logger = logger;
  }

  /**
   * Resolve playable episodes for a fitness show, enriched with watch state
   * and fitness-specific progress classification.
   *
   * @param {string} showId - Plex show ID (numeric string, e.g., "12345")
   * @param {string} [householdId] - Household ID for config lookup
   * @returns {Promise<{items: Array, parents: Object|null, container: Object|null}>}
   * @throws {Error} If adapter is missing or doesn't support resolvePlayables
   */
  async getPlayableEpisodes(showId, householdId) {
    if (!this.#contentAdapter) {
      throw new Error('Fitness content adapter not configured');
    }
    if (!this.#contentAdapter.resolvePlayables) {
      throw new Error('Content adapter does not support playable resolution');
    }

    const compoundId = `plex:${showId}`;

    // Load config for progress classification thresholds
    const fitnessConfig = this.#fitnessConfigService.loadRawConfig(householdId);
    const classifierConfig = fitnessConfig?.progressClassification || {};
    const classifier = this.#createProgressClassifier
      ? this.#createProgressClassifier(classifierConfig)
      : { classify: () => 'unknown' };

    // Resolve playable items from content adapter
    let items = await this.#contentAdapter.resolvePlayables(compoundId);

    // Enrich with watch state via ContentQueryService (DDD-compliant)
    if (this.#contentQueryService) {
      items = await this.#contentQueryService.enrichWithWatchState(items, 'plex', compoundId);
    }

    // Apply fitness-specific classification and map to API contract
    items = items.map(item => this.#classifyItem(item, classifier));

    // Build parents map from items' hierarchy metadata
    const parents = this.#buildParentsMap(items);

    // Get container info and item for show metadata
    const [info, containerItem] = await Promise.all([
      this.#contentAdapter.getContainerInfo
        ? this.#contentAdapter.getContainerInfo(compoundId)
        : null,
      this.#contentAdapter.getItem
        ? this.#contentAdapter.getItem(compoundId)
        : null
    ]);

    return {
      compoundId,
      showId,
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
    if (!this.#contentAdapter) {
      throw new Error('Fitness content adapter not configured');
    }

    const fitnessConfig = this.#fitnessConfigService.loadRawConfig(householdId);
    const libraryId = fitnessConfig?.plex?.library_id || 14;

    const items = await this.#contentAdapter.getList(`library/sections/${libraryId}/all`);

    const shows = items.map(item => ({
      id: item.localId || item.id?.replace('plex:', ''),
      title: item.title,
      type: item.itemType || item.metadata?.type,
      episodeCount: item.metadata?.leafCount || item.metadata?.childCount || null,
    }));

    return { shows, libraryId };
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

    return {
      ...item,
      watchProgress: percent,
      watchSeconds: playhead,
      watchedDate: item.lastPlayed ?? null,
      // Preserve undefined for watchTime so classifier can skip anti-seeking check when data is missing
      isWatched: classifier.classify(
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
        parentsMap[pId] = {
          index: item.metadata?.parentIndex,
          title: item.metadata?.parentTitle || 'Parent',
          thumbnail: item.metadata?.parentThumb || `/api/v1/content/plex/image/${pId}`,
          type: item.metadata?.parentType
        };
      }
    }

    return Object.keys(parentsMap).length > 0 ? parentsMap : null;
  }
}
