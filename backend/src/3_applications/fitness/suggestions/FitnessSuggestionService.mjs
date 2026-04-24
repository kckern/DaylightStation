/**
 * FitnessSuggestionService — orchestrates suggestion strategies to fill a grid.
 *
 * Runs strategies in priority order, deduplicates by showId,
 * and returns a unified sorted array of suggestion cards.
 */
export class FitnessSuggestionService {
  #strategies;
  #sessionService;
  #sessionDatastore;
  #fitnessConfigService;
  #fitnessPlayableService;
  #contentAdapter;
  #contentQueryService;
  #logger;

  // Cache for exclude_collections → showIds resolution. Collections change
  // rarely (user curates them manually), so a TTL of a few minutes is fine.
  #excludedCache = null; // { key: string, at: number, ids: Set<string> }
  static #EXCLUDED_TTL_MS = 5 * 60 * 1000;

  constructor({
    strategies,
    sessionService,
    sessionDatastore,
    fitnessConfigService,
    fitnessPlayableService,
    contentAdapter,
    contentQueryService,
    logger = console,
  }) {
    this.#strategies = strategies;
    this.#sessionService = sessionService;
    this.#sessionDatastore = sessionDatastore;
    this.#fitnessConfigService = fitnessConfigService;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#contentAdapter = contentAdapter;
    this.#contentQueryService = contentQueryService;
    this.#logger = logger;
  }

  /**
   * Resolve `suggestions.exclude_collections` to a Set of show-id strings.
   * Each entry is a Plex collection ID or playlist ID. Children can be shows
   * (containers) or episodes — either way we pull the show (grandparent) id.
   *
   * Cached with a short TTL so repeated suggestion calls don't hammer Plex.
   *
   * @param {Array<string|number>} excludeCollections
   * @returns {Promise<Set<string>>} show IDs (no `plex:` prefix)
   * @private
   */
  async #getExcludedShowIds(excludeCollections) {
    const key = JSON.stringify(excludeCollections || []);
    const now = Date.now();
    if (this.#excludedCache && this.#excludedCache.key === key
        && now - this.#excludedCache.at < FitnessSuggestionService.#EXCLUDED_TTL_MS) {
      return this.#excludedCache.ids;
    }
    const ids = new Set();
    if (Array.isArray(excludeCollections) && excludeCollections.length
        && this.#contentAdapter?.getList) {
      for (const cid of excludeCollections) {
        try {
          const items = await this.#contentAdapter.getList(String(cid));
          for (const item of items || []) {
            // Episodes carry grandparentRatingKey/grandparentId on metadata.
            // Shows (containers) have the show id in their own localId/id.
            const raw = item?.metadata?.grandparentRatingKey
              ?? item?.metadata?.grandparentId
              ?? item?.localId
              ?? (typeof item?.id === 'string' ? item.id : null);
            if (raw == null) continue;
            const sid = String(raw).replace(/^plex:/, '');
            if (sid) ids.add(sid);
          }
        } catch (err) {
          this.#logger.warn?.('suggestions.exclude-collection-resolve-failed',
            { collectionId: cid, error: err?.message });
        }
      }
    }
    this.#excludedCache = { key, at: now, ids };
    return ids;
  }

  async getSuggestions({ gridSize, householdId } = {}) {
    const fitnessConfig = this.#fitnessConfigService.loadRawConfig(householdId);
    const slots = gridSize || fitnessConfig?.suggestions?.grid_size || 8;
    const lookbackDays = fitnessConfig?.suggestions?.lookback_days ?? 10;

    // Fetch recent sessions for context
    const endDate = new Date().toISOString().split('T')[0];
    const startD = new Date();
    startD.setDate(startD.getDate() - lookbackDays);
    const startDate = startD.toISOString().split('T')[0];

    const hid = this.#sessionService.resolveHouseholdId(householdId);
    let recentSessions = [];
    try {
      recentSessions = await this.#sessionService.listSessionsInRange(startDate, endDate, hid);
    } catch (err) {
      this.#logger.warn?.('suggestions.sessions-fetch-failed', { error: err?.message });
    }

    // Resolve shows excluded via exclude_collections (Plex collection/playlist
    // membership). Applies to NextUp + Discovery; Resume / Favorite / Memorable
    // honor their own explicit signals so they still surface these.
    const excludedShowIds = await this.#getExcludedShowIds(
      fitnessConfig?.suggestions?.exclude_collections
    );

    // Build shared context
    const context = {
      recentSessions,
      fitnessConfig,
      householdId: hid,
      fitnessPlayableService: this.#fitnessPlayableService,
      contentAdapter: this.#contentAdapter,
      contentQueryService: this.#contentQueryService,
      sessionDatastore: this.#sessionDatastore,
      excludedShowIds,
    };

    // Run strategies in order, dedup by showId
    // Collect beyond gridSize into overflow for client-side card replacement
    const OVERFLOW_CAP = 4;
    const allCards = [];
    const usedShowIds = new Set();
    const maxCollect = slots + OVERFLOW_CAP;

    for (const strategy of this.#strategies) {
      const remaining = maxCollect - allCards.length;
      if (remaining <= 0) break;

      let cards;
      try {
        cards = await strategy.suggest(context, remaining);
      } catch (err) {
        this.#logger.error?.('suggestions.strategy-failed', {
          strategy: strategy.constructor?.name,
          error: err?.message,
        });
        continue;
      }

      for (const card of cards) {
        if (allCards.length >= maxCollect) break;
        if (card.showId && usedShowIds.has(card.showId)) continue;
        allCards.push(card);
        if (card.showId) usedShowIds.add(card.showId);
      }
    }

    const results = allCards.slice(0, slots);
    const overflow = allCards.slice(slots, slots + OVERFLOW_CAP);

    // Reorder top row: next_up cards left, resume cards right
    const topRow = results.slice(0, 4);
    const bottomRow = results.slice(4);
    topRow.sort((a, b) => {
      const aResume = a.type === 'resume' ? 1 : 0;
      const bResume = b.type === 'resume' ? 1 : 0;
      return aResume - bResume;
    });

    return { suggestions: [...topRow, ...bottomRow], overflow };
  }
}
