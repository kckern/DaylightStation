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
 * - Reports exhaustion instead of silently recycling seen content
 *
 * @module applications/feed/services
 */

import { ScrollConfigLoader } from './ScrollConfigLoader.mjs';

export class FeedPoolManager {
  #sourceAdapters;
  #feedCacheService;
  #queryConfigs;
  #loadUserQueries;
  #dismissedItemsStore;
  #logger;

  /** @type {Map<string, Object[]>} Per-user cached merged query configs */
  #userQueryConfigs = new Map();

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

  /** @type {Map<string, number>} Per-user batch counter (1-indexed after first getPool call) */
  #batchCounts = new Map();

  /** @type {Map<string, Object>} Per-user cached scrollConfig */
  #scrollConfigs = new Map();

  /** @type {Map<string, string|null>} Cached first-page cursors keyed by sourceKey */
  #firstPageCursors = new Map();

  static #REFILL_THRESHOLD_MULTIPLIER = 2;
  static #MAX_SEEN_ITEMS = 500;
  static #SOURCE_TIMEOUT_MS = 20_000;

  /**
   * @param {Object} deps
   * @param {Object[]} deps.sourceAdapters - Feed source adapters keyed by sourceType (required for any fetching)
   * @param {Object} [deps.feedCacheService=null] - Cache layer; without it every first-page fetch hits the source adapter directly
   * @param {Object[]} [deps.queryConfigs=[]] - Household-level query configs; without them no sources are fetched unless user queries supply them
   * @param {Function} [deps.loadUserQueries=null] - Loader for per-user query overrides; without it all users share household queries only
   * @param {Object} [deps.dismissedItemsStore=null] - Dismissed-items store; without it dismissed items reappear on recycle and pool filtering
   * @param {Object} [deps.logger=console] - Logger instance; falls back to console (throws if explicitly null)
   */
  constructor({
    sourceAdapters = [],
    feedCacheService = null,
    queryConfigs = [],
    loadUserQueries = null,
    dismissedItemsStore = null,
    logger = console,
  }) {
    if (!logger) throw new Error('FeedPoolManager requires a logger');

    this.#sourceAdapters = new Map();
    for (const adapter of sourceAdapters) {
      this.#sourceAdapters.set(adapter.sourceType, adapter);
    }
    this.#feedCacheService = feedCacheService;
    this.#queryConfigs = queryConfigs;
    this.#loadUserQueries = loadUserQueries;
    this.#dismissedItemsStore = dismissedItemsStore;
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
  async getPool(username, scrollConfig, { stripLimits = false, sessionId = null } = {}) {
    const key = this.#stateKey(username, sessionId);
    this.#scrollConfigs.set(key, scrollConfig);

    if (!this.#pools.has(key)) {
      await this.#initializePool(key, username, scrollConfig, { stripLimits });
    }

    // Increment batch counter (1-indexed: first getPool call = batch 1)
    this.#batchCounts.set(key, (this.#batchCounts.get(key) || 0) + 1);

    const pool = this.#pools.get(key) || [];
    const seen = this.#seenIds.get(key) || new Set();
    const dismissed = this.#dismissedItemsStore?.load() || new Set();

    // Tag items with seen status — seen influences priority, not exclusion.
    // This ensures non-wire tiers always have content (seen items recycle as fallback).
    for (const item of pool) {
      item._seen = seen.has(item.id);
    }

    const available = pool.filter(item => !dismissed.has(item.id));
    const unseenCount = available.filter(i => !i._seen).length;

    // If no unseen items remain but sources can provide more, refill for fresh content.
    if (unseenCount === 0 && this.#hasRefillableSources(key)) {
      await this.#proactiveRefill(key, username, scrollConfig);
      const refreshed = this.#pools.get(key) || [];
      for (const item of refreshed) {
        item._seen = seen.has(item.id);
      }
      return refreshed.filter(item => !dismissed.has(item.id));
    }

    return available;
  }

  /**
   * Mark item IDs as seen (consumed by a batch).
   * Triggers proactive refill if remaining pool is thin.
   *
   * @param {string} username
   * @param {string[]} feedItemIds
   */
  markSeen(username, feedItemIds, sessionId = null) {
    const key = this.#stateKey(username, sessionId);
    const seen = this.#seenIds.get(key) || new Set();
    const history = this.#seenItems.get(key) || [];
    const pool = this.#pools.get(key) || [];

    for (const id of feedItemIds) {
      seen.add(id);
      const item = pool.find(i => i.id === id);
      if (item) history.push(item);
    }

    this.#seenIds.set(key, seen);
    // Cap history to prevent unbounded memory growth
    if (history.length > FeedPoolManager.#MAX_SEEN_ITEMS) {
      history.splice(0, history.length - FeedPoolManager.#MAX_SEEN_ITEMS);
    }
    this.#seenItems.set(key, history);

    const unseenRemaining = pool.filter(i => !seen.has(i.id)).length;
    const scrollConfig = this.#scrollConfigs.get(key);
    const batchSize = scrollConfig?.batch_size ?? 15;
    const threshold = batchSize * FeedPoolManager.#REFILL_THRESHOLD_MULTIPLIER;

    if (unseenRemaining < threshold) {
      if (this.#hasRefillableSources(key)) {
        this.#proactiveRefill(key, username, scrollConfig);
      }
    }
  }

  /**
   * Whether more items can be served.
   * @param {string} username
   * @returns {boolean}
   */
  hasMore(username, sessionId = null) {
    const key = this.#stateKey(username, sessionId);
    const pool = this.#pools.get(key) || [];
    const seen = this.#seenIds.get(key) || new Set();
    const remaining = pool.filter(i => !seen.has(i.id)).length;
    return remaining > 0 || this.#hasRefillableSources(key);
  }

  /**
   * Reset all state for a user (called on fresh page load, no cursor).
   * @param {string} username
   */
  reset(username, sessionId = null) {
    const key = this.#stateKey(username, sessionId);
    this.#pools.delete(key);
    this.#seenIds.delete(key);
    this.#seenItems.delete(key);
    this.#cursors.delete(key);
    this.#refilling.delete(key);
    this.#scrollConfigs.delete(key);
    this.#batchCounts.delete(key);
    this.#userQueryConfigs.delete(username);
    this.#dismissedItemsStore?.clearCache();
  }

  /**
   * Get the current batch number for a user (1-indexed).
   * Returns 0 if no batches have been served yet.
   * @param {string} username
   * @returns {number}
   */
  getBatchNumber(username, sessionId = null) {
    return this.#batchCounts.get(this.#stateKey(username, sessionId)) || 0;
  }

  hasSession(username, sessionId) {
    return this.#pools.has(this.#stateKey(username, sessionId));
  }

  snapshot(username, sessionId) {
    const key = this.#stateKey(username, sessionId);
    if (!this.#pools.has(key)) return null;
    return {
      pool: this.#pools.get(key),
      seenIds: [...(this.#seenIds.get(key) || [])],
      seenItems: this.#seenItems.get(key) || [],
      cursors: [...(this.#cursors.get(key) || new Map()).entries()],
      batchCount: this.#batchCounts.get(key) || 0,
      scrollConfig: this.#scrollConfigs.get(key) || null,
    };
  }

  restore(username, sessionId, snapshot) {
    if (!snapshot?.pool || !Array.isArray(snapshot.pool)) return false;
    const key = this.#stateKey(username, sessionId);
    this.#pools.set(key, snapshot.pool);
    this.#seenIds.set(key, new Set(snapshot.seenIds || []));
    this.#seenItems.set(key, snapshot.seenItems || []);
    this.#cursors.set(key, new Map(snapshot.cursors || []));
    this.#batchCounts.set(key, snapshot.batchCount || 0);
    if (snapshot.scrollConfig) this.#scrollConfigs.set(key, snapshot.scrollConfig);
    return true;
  }

  getSessionItems(username, sessionId) {
    return [...(this.#seenItems.get(this.#stateKey(username, sessionId)) || [])];
  }

  getSessionConfig(username, sessionId) {
    return this.#scrollConfigs.get(this.#stateKey(username, sessionId)) || null;
  }

  // =========================================================================
  // Internal: Pool Initialization
  // =========================================================================

  async #initializePool(key, username, scrollConfig, { stripLimits = false } = {}) {
    let queries = this.#filterQueries(scrollConfig, username);
    // Drive pool depth from batch_size — don't rely on hardcoded YAML limits.
    // Each query gets batch_size as its limit so the pool can fill any allocation.
    const poolLimit = stripLimits ? 10000 : (scrollConfig.batch_size || 50);
    queries = queries.map(q => ({ ...q, limit: q.limit || poolLimit }));
    const results = await Promise.allSettled(
      queries.map(query => FeedPoolManager.#withTimeout(
        this.#fetchSourcePage(query, username, scrollConfig, undefined, { noCache: stripLimits }),
        FeedPoolManager.#SOURCE_TIMEOUT_MS,
      ))
    );

    const allItems = [];
    const cursorMap = this.#cursors.get(key) || new Map();

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

    this.#cursors.set(key, cursorMap);
    this.#pools.set(key, allItems);
    this.#seenIds.set(key, new Set());
    this.#seenItems.set(key, []);
  }

  // =========================================================================
  // Internal: Source Fetching (Page-Aware)
  // =========================================================================

  async #fetchSourcePage(query, username, scrollConfig, cursorToken = undefined, { noCache = false } = {}) {
    const sourceKey = query._filename?.replace('.yml', '') || query.type;
    const maxAgeMs = ScrollConfigLoader.getMaxAgeMs(scrollConfig, sourceKey);
    const now = Date.now();

    let items, cursor;

    const adapter = this.#sourceAdapters.get(query.type);
    if (adapter && typeof adapter.fetchPage === 'function') {
      if (this.#feedCacheService && cursorToken === undefined && !noCache) {
        // First page: use cache service.
        // The fetchFn may not be invoked (cache hit), so persist cursor
        // separately: when the callback runs, store cursor in #firstPageCursors;
        // on cache hit, read back the previously stored cursor.
        const cached = await this.#feedCacheService.getItems(sourceKey, async () => {
          const result = await adapter.fetchPage(query, username, { cursor: cursorToken });
          this.#firstPageCursors.set(`${username}:${sourceKey}`, result.cursor);
          return result.items;
        }, username);
        items = cached;
        cursor = this.#firstPageCursors.get(`${username}:${sourceKey}`) ?? null;
      } else {
        // Subsequent pages or no cache: direct fetch
        const result = await adapter.fetchPage(query, username, { cursor: cursorToken });
        items = result.items;
        cursor = result.cursor;
      }
    } else if (adapter) {
      // Legacy adapter without fetchPage
      const fetchFn = () => adapter.fetchItems(query, username);
      if (this.#feedCacheService && !noCache) {
        items = await this.#feedCacheService.getItems(sourceKey, fetchFn, username);
      } else {
        items = await fetchFn();
      }
      cursor = null;
    } else {
      this.#logger.warn?.('feed.pool.unknown.type', { type: query.type });
      items = [];
      cursor = null;
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

  async #proactiveRefill(key, username, scrollConfig) {
    if (this.#refilling.get(key)) return;
    this.#refilling.set(key, true);

    try {
      const cursorMap = this.#cursors.get(key) || new Map();
      const queries = this.#filterQueries(scrollConfig, username);
      const pool = this.#pools.get(key) || [];
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

      this.#pools.set(key, pool);
      this.#logger.info?.('feed.pool.refill.complete', { username, newItems: newItemCount });
    } catch (err) {
      this.#logger.warn?.('feed.pool.refill.error', { error: err.message });
    } finally {
      this.#refilling.delete(key);
    }
  }

  // =========================================================================
  // Internal: Helpers
  // =========================================================================

  #getQueryConfigs(username) {
    if (this.#userQueryConfigs.has(username)) {
      return this.#userQueryConfigs.get(username);
    }
    // Start with household queries keyed by filename
    const merged = new Map(this.#queryConfigs.map(q => [q._filename, q]));
    // User queries override household with same filename
    if (this.#loadUserQueries) {
      for (const q of this.#loadUserQueries(username)) {
        merged.set(q._filename, q);
      }
    }
    const configs = Array.from(merged.values());
    this.#userQueryConfigs.set(username, configs);
    return configs;
  }

  #filterQueries(scrollConfig, username) {
    const queryConfigs = username ? this.#getQueryConfigs(username) : this.#queryConfigs;
    const enabledSources = ScrollConfigLoader.getEnabledSources(scrollConfig);
    if (enabledSources.size === 0) return queryConfigs;
    return queryConfigs.filter(query => {
      const key = query._filename?.replace('.yml', '');
      return key && enabledSources.has(key);
    });
  }

  #stateKey(username, sessionId) {
    return sessionId ? `${username}\u0000${sessionId}` : username;
  }

  static #withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Source fetch timed out after ${ms}ms`)), ms)),
    ]);
  }

}

export default FeedPoolManager;
