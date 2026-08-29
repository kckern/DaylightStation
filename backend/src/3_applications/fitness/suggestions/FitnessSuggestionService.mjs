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
  #contentCatalog;
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
    contentCatalog,
    logger = console,
  }) {
    this.#strategies = strategies;
    this.#sessionService = sessionService;
    this.#sessionDatastore = sessionDatastore;
    this.#fitnessConfigService = fitnessConfigService;
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#contentCatalog = contentCatalog;
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
        && this.#contentCatalog?.collectionShowIds) {
      for (const cid of excludeCollections) {
        try {
          const showIds = await this.#contentCatalog.collectionShowIds(String(cid));
          showIds.forEach((showId) => ids.add(showId));
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
    const suggestionPolicy = this.#fitnessConfigService.getSuggestionPolicy(householdId);
    const slots = gridSize || suggestionPolicy.slots;
    const lookbackDays = suggestionPolicy.lookbackDays;

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
      suggestionPolicy.excludedCollectionIds
    );

    // Request-scoped memo for getPlayableEpisodes. The same show is resolved by
    // multiple strategies (Resume + NextUp both walk recent shows; Favorite /
    // Memorable overlap), and each resolution is ~3-4 Plex round-trips. Dedupe
    // within a single request so each show is fetched at most once. Results are
    // used read-only by strategies, so sharing the object is safe. We cache the
    // promise so an in-flight resolution is shared too.
    const playableMemo = new Map(); // 'showId::hid' -> Promise
    const playableStats = { calls: 0, misses: 0 };
    const memoizedPlayableService = {
      getPlayableEpisodes: (showId, hhid = hid) => {
        playableStats.calls++;
        const memoKey = `${showId}::${hhid ?? ''}`;
        if (!playableMemo.has(memoKey)) {
          playableStats.misses++;
          playableMemo.set(memoKey, this.#fitnessPlayableService.getPlayableEpisodes(showId, hhid));
        }
        return playableMemo.get(memoKey);
      },
      listFitnessShows: (...args) => this.#fitnessPlayableService.listFitnessShows(...args),
    };

    // Build shared context
    const context = {
      recentSessions,
      suggestionPolicy,
      householdId: hid,
      fitnessPlayableService: memoizedPlayableService,
      contentCatalog: this.#contentCatalog,
      sessionDatastore: this.#sessionDatastore,
      excludedShowIds,
    };

    // Run strategies in order, dedup by showId
    // Collect beyond gridSize into overflow for client-side card replacement
    const OVERFLOW_CAP = 4;
    const allCards = [];
    const usedShowIds = new Set();
    const maxCollect = slots + OVERFLOW_CAP;
    const strategyTimings = [];

    for (const strategy of this.#strategies) {
      const remaining = maxCollect - allCards.length;
      if (remaining <= 0) break;

      let cards;
      const stratStart = Date.now();
      try {
        cards = await strategy.suggest(context, remaining);
      } catch (err) {
        this.#logger.error?.('suggestions.strategy-failed', {
          strategy: strategy.constructor?.name,
          error: err?.message,
        });
        continue;
      }
      strategyTimings.push({
        strategy: strategy.constructor?.name,
        ms: Date.now() - stratStart,
        cards: Array.isArray(cards) ? cards.length : 0,
      });

      for (const card of cards) {
        if (allCards.length >= maxCollect) break;
        if (card.showId && usedShowIds.has(card.showId)) continue;
        allCards.push(card);
        if (card.showId) usedShowIds.add(card.showId);
      }
    }

    // Per-strategy + memo-hit breakdown so the suggestions latency is attributable
    // (playable.calls vs playable.misses shows how much the memo deduped).
    this.#logger.info?.('suggestions.breakdown', {
      slots,
      strategyTimings,
      playableCalls: playableStats.calls,
      playableMisses: playableStats.misses,
      playableDeduped: playableStats.calls - playableStats.misses,
    });

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
