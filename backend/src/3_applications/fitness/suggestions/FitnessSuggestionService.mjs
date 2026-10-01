import { isSuggestiblePlayable } from './suggestibleEpisode.mjs';

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
  #excludedCache = new Map(); // key -> { at: number, ids: Set<string> }
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
   * Past the TTL the last set is served while one background resolve renews
   * it: the home screen polls on the same 5-minute period, so blocking on
   * expiry put this Plex walk (~1s) in front of nearly every poll.
   *
   * @param {Array<string|number>} excludeCollections
   * @returns {Promise<Set<string>>} show IDs (no `plex:` prefix)
   * @private
   */
  async #getExcludedShowIds(excludeCollections) {
    const key = JSON.stringify(excludeCollections || []);
    const cached = this.#excludedCache.get(key);
    if (cached) {
      if (Date.now() - cached.at >= FitnessSuggestionService.#EXCLUDED_TTL_MS && !cached.renewing) {
        cached.renewing = true;
        this.#resolveExcludedShowIds(excludeCollections)
          .then((ids) => { this.#excludedCache.set(key, { at: Date.now(), ids }); })
          .finally(() => { cached.renewing = false; });
      }
      return cached.ids;
    }
    const ids = await this.#resolveExcludedShowIds(excludeCollections);
    this.#excludedCache.set(key, { at: Date.now(), ids });
    return ids;
  }

  async #resolveExcludedShowIds(excludeCollections) {
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
    const sessionsStart = Date.now();
    let recentSessions = [];
    try {
      recentSessions = await this.#sessionService.listSessionsInRange(startDate, endDate, hid);
    } catch (err) {
      this.#logger.warn?.('suggestions.sessions-fetch-failed', { error: err?.message });
    }

    const sessionsMs = Date.now() - sessionsStart;

    // Resolve shows excluded via exclude_collections (Plex collection/playlist
    // membership). Applies to NextUp + Discovery; Resume / Favorite / Memorable
    // honor their own explicit signals so they still surface these.
    const excludedStart = Date.now();
    const excludedShowIds = await this.#getExcludedShowIds(
      suggestionPolicy.excludedCollectionIds
    );
    // `never_suggest_collections` (e.g. the Kids menu collection) drops its shows
    // from every strategy's cards EXCEPT Resume. Resume is not a suggestion, it
    // is the episode someone is partway through, and it owns the top-right slot:
    // a kid mid-way through a Game Cycling ride must be able to pick it back up.
    const neverSuggestShowIds = await this.#getExcludedShowIds(
      suggestionPolicy.neverSuggestCollectionIds
    );

    const excludedMs = Date.now() - excludedStart;

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
          // Season-0 extras and short filler are never suggestible, so no
          // strategy sees them — NextUp skips past them, Resume never offers them.
          playableMemo.set(memoKey, this.#fitnessPlayableService.getPlayableEpisodes(showId, hhid)
            .then(data => ({
              ...data,
              items: (data?.items || []).filter(ep => isSuggestiblePlayable(ep, suggestionPolicy)),
            })));
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
      // describeItem goes through the playable service's structure cache:
      // Favorite / Memorable describe shows other strategies already resolved,
      // and uncached each one was two more serialized Plex calls per request.
      contentCatalog: {
        canonicalize: (id) => this.#contentCatalog.canonicalize(id),
        describeItem: (id) => this.#fitnessPlayableService.describeItem(id),
      },
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
        if (card.type !== 'resume' && card.showId && neverSuggestShowIds.size
            && neverSuggestShowIds.has(this.#contentCatalog.canonicalize(card.showId).localId)) continue;
        allCards.push(card);
        if (card.showId) usedShowIds.add(card.showId);
      }
    }

    // Per-strategy + memo-hit breakdown so the suggestions latency is attributable
    // (playable.calls vs playable.misses shows how much the memo deduped).
    this.#logger.info?.('suggestions.breakdown', {
      slots,
      sessionsMs,
      excludedMs,
      recentSessions: recentSessions.length,
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
