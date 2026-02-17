// backend/src/3_applications/feed/services/FeedPoolManager.mjs
/**
 * FeedPoolManager
 *
 * Manages a per-user pool of feed items with on-demand source pagination.
 * Sits between FeedAssemblyService and source adapters/cache.
 *
 * Responsibilities:
 * - Accumulates items from paginated source fetches
 * - Tracks per-source continuation cursors
 * - Proactively refills when pool runs thin
 * - Enforces per-source max_age_hours thresholds
 * - Silently recycles seen items when all sources exhaust
 *
 * @module applications/feed/services
 */

import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';

export class FeedPoolManager {
  #sourceAdapters;
  #feedCacheService;
  #queryConfigs;
  #freshRSSAdapter;
  #headlineService;
  #entropyService;
  #logger;

  /** @type {Map<string, Object[]>} Per-user accumulated pool */
  #pools = new Map();

  /** @type {Map<string, Set<string>>} Per-user seen item IDs */
  #seenIds = new Map();

  /** @type {Map<string, Object[]>} Per-user history for recycling */
  #seenItems = new Map();

  /** @type {Map<string, Map<string, { cursor: string|null, exhausted: boolean, lastFetch: number }>>} */
  #cursors = new Map();

  /** @type {Map<string, boolean>} Per-user refill-in-progress flag */
  #refilling = new Map();

  /** @type {Map<string, Object>} Per-user cached scrollConfig */
  #scrollConfigs = new Map();

  /** @type {Map<string, string|null>} Cached first-page cursors keyed by sourceKey */
  #firstPageCursors = new Map();

  static #REFILL_THRESHOLD_MULTIPLIER = 2;
  static #MAX_SEEN_ITEMS = 500;

  constructor({
    sourceAdapters = [],
    feedCacheService = null,
    queryConfigs = [],
    freshRSSAdapter = null,
    headlineService = null,
    entropyService = null,
    logger = console,
  }) {
    if (!logger) throw new Error('FeedPoolManager requires a logger');

    this.#sourceAdapters = new Map();
    for (const adapter of sourceAdapters) {
      this.#sourceAdapters.set(adapter.sourceType, adapter);
    }
    this.#feedCacheService = feedCacheService;
    this.#queryConfigs = queryConfigs;
    this.#freshRSSAdapter = freshRSSAdapter;
    this.#headlineService = headlineService;
    this.#entropyService = entropyService;
    this.#logger = logger;
  }

  /**
   * Get the current item pool for a user (excluding seen items).
   * Triggers proactive refill if pool is thin.
   *
   * @param {string} username
   * @param {Object} scrollConfig - Merged scroll config from ScrollConfigLoader
   * @returns {Promise<Object[]>}
   */
  async getPool(username, scrollConfig) {
    this.#scrollConfigs.set(username, scrollConfig);

    if (!this.#pools.has(username)) {
      await this.#initializePool(username, scrollConfig);
    }

    const pool = this.#pools.get(username) || [];
    const seen = this.#seenIds.get(username) || new Set();
    const remaining = pool.filter(item => !seen.has(item.id));

    // If pool is empty but sources remain, await a refill instead of
    // returning nothing while fire-and-forget refill runs in background.
    if (remaining.length === 0 && this.#hasRefillableSources(username)) {
      await this.#proactiveRefill(username, scrollConfig);
      const refreshed = this.#pools.get(username) || [];
      return refreshed.filter(item => !seen.has(item.id));
    }

    return remaining;
  }

  /**
   * Mark item IDs as seen (consumed by a batch).
   * Triggers proactive refill if remaining pool is thin.
   * Triggers silent recycling if pool is empty and all sources exhausted.
   *
   * @param {string} username
   * @param {string[]} itemIds
   */
  markSeen(username, itemIds) {
    const seen = this.#seenIds.get(username) || new Set();
    const history = this.#seenItems.get(username) || [];
    const pool = this.#pools.get(username) || [];

    for (const id of itemIds) {
      seen.add(id);
      const item = pool.find(i => i.id === id);
      if (item) history.push(item);
    }

    this.#seenIds.set(username, seen);
    // Cap history to prevent unbounded memory growth
    if (history.length > FeedPoolManager.#MAX_SEEN_ITEMS) {
      history.splice(0, history.length - FeedPoolManager.#MAX_SEEN_ITEMS);
    }
    this.#seenItems.set(username, history);

    const remaining = pool.filter(i => !seen.has(i.id)).length;
    const scrollConfig = this.#scrollConfigs.get(username);
    const batchSize = scrollConfig?.batch_size ?? 15;
    const threshold = batchSize * FeedPoolManager.#REFILL_THRESHOLD_MULTIPLIER;

    if (remaining < threshold) {
      if (this.#hasRefillableSources(username)) {
        this.#proactiveRefill(username, scrollConfig);
      } else if (remaining === 0) {
        this.#recycle(username);
      }
    }
  }

  /**
   * Whether more items can be served.
   * @param {string} username
   * @returns {boolean}
   */
  hasMore(username) {
    const pool = this.#pools.get(username) || [];
    const seen = this.#seenIds.get(username) || new Set();
    const remaining = pool.filter(i => !seen.has(i.id)).length;
    return remaining > 0 || this.#hasRefillableSources(username) || (this.#seenItems.get(username)?.length || 0) > 0;
  }

  /**
   * Reset all state for a user (called on fresh page load, no cursor).
   * @param {string} username
   */
  reset(username) {
    this.#pools.delete(username);
    this.#seenIds.delete(username);
    this.#seenItems.delete(username);
    this.#cursors.delete(username);
    this.#refilling.delete(username);
    this.#scrollConfigs.delete(username);
    this.#firstPageCursors.clear();
  }

  // =========================================================================
  // Internal: Pool Initialization
  // =========================================================================

  async #initializePool(username, scrollConfig) {
    const queries = this.#filterQueries(scrollConfig);
    const results = await Promise.allSettled(
      queries.map(query => this.#fetchSourcePage(query, username, scrollConfig))
    );

    const allItems = [];
    const cursorMap = this.#cursors.get(username) || new Map();

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const { items, cursor, sourceKey } = results[i].value;
        allItems.push(...items);
        cursorMap.set(sourceKey, {
          cursor,
          exhausted: cursor === null,
          lastFetch: Date.now(),
        });
      } else {
        this.#logger.warn?.('feed.pool.init.source.failed', {
          query: queries[i].type,
          error: results[i].reason?.message,
        });
      }
    }

    this.#cursors.set(username, cursorMap);
    this.#pools.set(username, allItems);
    this.#seenIds.set(username, new Set());
    this.#seenItems.set(username, []);
  }

  // =========================================================================
  // Internal: Source Fetching (Page-Aware)
  // =========================================================================

  async #fetchSourcePage(query, username, scrollConfig, cursorToken = undefined) {
    const sourceKey = query._filename?.replace('.yml', '') || query.type;
    const maxAgeMs = ScrollConfigLoader.getMaxAgeMs(scrollConfig, sourceKey);
    const now = Date.now();

    let items, cursor;

    const adapter = this.#sourceAdapters.get(query.type);
    if (adapter && typeof adapter.fetchPage === 'function') {
      if (this.#feedCacheService && cursorToken === undefined) {
        // First page: use cache service.
        // The fetchFn may not be invoked (cache hit), so persist cursor
        // separately: when the callback runs, store cursor in #firstPageCursors;
        // on cache hit, read back the previously stored cursor.
        const cached = await this.#feedCacheService.getItems(sourceKey, async () => {
          const result = await adapter.fetchPage(query, username, { cursor: cursorToken });
          this.#firstPageCursors.set(sourceKey, result.cursor);
          return result.items;
        }, username);
        items = cached;
        cursor = this.#firstPageCursors.get(sourceKey) ?? null;
      } else {
        // Subsequent pages or no cache: direct fetch
        const result = await adapter.fetchPage(query, username, { cursor: cursorToken });
        items = result.items;
        cursor = result.cursor;
      }
    } else if (adapter) {
      // Legacy adapter without fetchPage
      const fetchFn = () => adapter.fetchItems(query, username);
      if (this.#feedCacheService) {
        items = await this.#feedCacheService.getItems(sourceKey, fetchFn, username);
      } else {
        items = await fetchFn();
      }
      cursor = null;
    } else {
      // Built-in handlers (freshrss, headlines, entropy)
      const result = await this.#fetchBuiltinPage(query, username, cursorToken);
      items = result.items;
      cursor = result.cursor;
    }

    // Age filter: discard items older than max_age_hours
    if (maxAgeMs !== null && items.length > 0) {
      const cutoff = now - maxAgeMs;
      const beforeCount = items.length;
      items = items.filter(item => {
        const ts = new Date(item.timestamp).getTime();
        return ts >= cutoff;
      });
      if (items.length < beforeCount) {
        this.#logger.info?.('feed.pool.age.filtered', {
          sourceKey, before: beforeCount, after: items.length, maxAgeHours: maxAgeMs / 3600000,
        });
      }
      // Entire page stale → mark source exhausted
      if (items.length === 0 && beforeCount > 0) {
        cursor = null;
      }
    }

    // Tag items with query name for filter matching
    const queryName = query._filename?.replace('.yml', '') || null;
    if (queryName) {
      for (const item of items) {
        item.meta = item.meta || {};
        item.meta.queryName = queryName;
      }
    }

    return { items, cursor, sourceKey };
  }

  async #fetchBuiltinPage(query, username, cursorToken) {
    switch (query.type) {
      case 'freshrss': return this.#fetchFreshRSSPage(query, username, cursorToken);
      case 'headlines': return this.#fetchHeadlinesPage(query, username, cursorToken);
      case 'entropy':   return { items: await this.#fetchEntropy(query, username), cursor: null };
      default:
        this.#logger.warn?.('feed.pool.unknown.type', { type: query.type });
        return { items: [], cursor: null };
    }
  }

  async #fetchFreshRSSPage(query, username, cursorToken) {
    if (!this.#freshRSSAdapter) return { items: [], cursor: null };
    const { items: rawItems, continuation } = await this.#freshRSSAdapter.getItems(
      'user/-/state/com.google/reading-list',
      username,
      {
        excludeRead: query.params?.excludeRead ?? true,
        count: query.limit || 20,
        continuation: cursorToken || undefined,
      }
    );
    const items = (rawItems || []).map(item => ({
      id: `freshrss:${item.id}`,
      tier: query.tier || 'wire',
      source: 'freshrss',
      title: item.title,
      body: item.content ? item.content.replace(/<[^>]*>/g, '').slice(0, 200) : null,
      image: this.#extractImage(item.content),
      link: item.link,
      timestamp: item.published?.toISOString?.() || item.published || new Date().toISOString(),
      priority: query.priority || 0,
      meta: {
        feedTitle: item.feedTitle,
        author: item.author,
        sourceName: item.feedTitle || 'RSS',
        sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
      },
    }));
    return { items, cursor: continuation || null };
  }

  async #fetchHeadlinesPage(query, username, cursorToken) {
    if (!this.#headlineService) return { items: [], cursor: null };
    const pages = this.#headlineService.getPageList(username);
    const firstPageId = pages[0]?.id;
    if (!firstPageId) return { items: [], cursor: null };

    const result = await this.#headlineService.getAllHeadlines(username, firstPageId);
    const totalLimit = query.limit || 30;
    const offset = cursorToken ? parseInt(cursorToken, 10) : 0;
    const allItems = [];

    for (const [sourceId, source] of Object.entries(result.sources || {})) {
      for (const item of (source.items || [])) {
        allItems.push({
          id: `headline:${item.id || sourceId + ':' + item.link}`,
          tier: query.tier || 'wire',
          source: 'headline',
          title: item.title,
          body: item.desc || null,
          image: item.image || null,
          link: item.link,
          timestamp: item.timestamp || new Date().toISOString(),
          priority: query.priority || 0,
          meta: {
            sourceId,
            sourceLabel: source.label,
            sourceName: source.label || sourceId,
            sourceIcon: item.link ? (() => { try { return new URL(item.link).origin; } catch { return null; } })() : null,
            paywall: source.paywall || false,
            paywallProxy: source.paywall ? result.paywallProxy : null,
            ...(item.imageWidth && item.imageHeight
              ? { imageWidth: item.imageWidth, imageHeight: item.imageHeight }
              : {}),
          },
        });
      }
    }

    allItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const page = allItems.slice(offset, offset + totalLimit);
    const nextOffset = offset + totalLimit;
    const hasMore = nextOffset < allItems.length;
    return { items: page, cursor: hasMore ? String(nextOffset) : null };
  }

  async #fetchEntropy(query, username) {
    if (!this.#entropyService) return [];
    const report = await this.#entropyService.getReport(username);
    let items = report.items || [];
    if (query.params?.onlyYellowRed) {
      items = items.filter(item => item.status === 'yellow' || item.status === 'red');
    }
    return items.map(item => ({
      id: `entropy:${item.source}`,
      tier: query.tier || 'compass',
      source: 'entropy',
      title: item.name || item.source,
      body: item.label || `${item.value} since last update`,
      image: null,
      link: item.url || null,
      timestamp: item.lastUpdate || new Date().toISOString(),
      priority: query.priority || 20,
      meta: { status: item.status, icon: item.icon, value: item.value, weight: item.weight, sourceName: 'Data Freshness', sourceIcon: null },
    }));
  }

  // =========================================================================
  // Internal: Proactive Refill
  // =========================================================================

  #hasRefillableSources(username) {
    const cursorMap = this.#cursors.get(username);
    if (!cursorMap) return false;
    for (const state of cursorMap.values()) {
      if (!state.exhausted && state.cursor !== null) return true;
    }
    return false;
  }

  async #proactiveRefill(username, scrollConfig) {
    if (this.#refilling.get(username)) return;
    this.#refilling.set(username, true);

    try {
      const cursorMap = this.#cursors.get(username) || new Map();
      const queries = this.#filterQueries(scrollConfig);
      const pool = this.#pools.get(username) || [];
      const existingIds = new Set(pool.map(i => i.id));

      const refillable = queries.filter(q => {
        const key = q._filename?.replace('.yml', '') || q.type;
        const state = cursorMap.get(key);
        return state && !state.exhausted && state.cursor !== null;
      });

      const results = await Promise.allSettled(
        refillable.map(query => {
          const key = query._filename?.replace('.yml', '') || query.type;
          const cursorToken = cursorMap.get(key).cursor;
          return this.#fetchSourcePage(query, username, scrollConfig, cursorToken);
        })
      );

      let newItemCount = 0;
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          const { items, cursor, sourceKey } = results[i].value;
          const fresh = items.filter(item => !existingIds.has(item.id));
          pool.push(...fresh);
          for (const item of fresh) existingIds.add(item.id);
          newItemCount += fresh.length;

          cursorMap.set(sourceKey, {
            cursor,
            exhausted: cursor === null,
            lastFetch: Date.now(),
          });
        }
      }

      this.#pools.set(username, pool);
      this.#logger.info?.('feed.pool.refill.complete', { username, newItems: newItemCount });
    } catch (err) {
      this.#logger.warn?.('feed.pool.refill.error', { error: err.message });
    } finally {
      this.#refilling.delete(username);
    }
  }

  // =========================================================================
  // Internal: Silent Recycling
  // =========================================================================

  #recycle(username) {
    const history = this.#seenItems.get(username) || [];
    if (history.length === 0) return;

    const shuffled = [...history];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    this.#pools.set(username, shuffled);
    this.#seenIds.set(username, new Set());
    this.#logger.info?.('feed.pool.recycled', { username, items: shuffled.length });
  }

  // =========================================================================
  // Internal: Helpers
  // =========================================================================

  #filterQueries(scrollConfig) {
    const enabledSources = ScrollConfigLoader.getEnabledSources(scrollConfig);
    if (enabledSources.size === 0) return this.#queryConfigs;
    return this.#queryConfigs.filter(query => {
      const key = query._filename?.replace('.yml', '');
      return key && enabledSources.has(key);
    });
  }

  #extractImage(html) {
    if (!html) return null;
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match ? match[1] : null;
  }
}

export default FeedPoolManager;
