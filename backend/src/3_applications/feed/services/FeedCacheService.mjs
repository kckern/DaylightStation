// backend/src/3_applications/feed/services/FeedCacheService.mjs
/**
 * FeedCacheService
 *
 * Stale-while-revalidate cache for feed source adapter results.
 * In-memory Map backed by YAML file for persistence across restarts.
 *
 * Lifecycle:
 * 1. First request: hydrate from _cache.yml into memory
 * 2. Fresh cache hit: serve from memory
 * 3. Stale cache hit: serve from memory, background refresh + disk flush
 * 4. Cold (no cache): await fetch, cache + flush
 *
 * @module applications/feed/services
 */

const CACHE_PATH = 'current/feed/_cache';

/** Default TTLs in milliseconds, keyed by source type */
const DEFAULT_TTLS = Object.freeze({
  headlines:  15 * 60 * 1000,
  freshrss:   10 * 60 * 1000,
  reddit:      5 * 60 * 1000,
  youtube:    15 * 60 * 1000,
  googlenews: 10 * 60 * 1000,
  komga:      30 * 60 * 1000,
  photos:     30 * 60 * 1000,
  journal:    30 * 60 * 1000,
  entropy:     5 * 60 * 1000,
  tasks:       5 * 60 * 1000,
  health:      5 * 60 * 1000,
  weather:     5 * 60 * 1000,
  fitness:     5 * 60 * 1000,
  gratitude:   5 * 60 * 1000,
  'plex-music': 30 * 60 * 1000,
  plex:       30 * 60 * 1000,
});

const DEFAULT_TTL = 10 * 60 * 1000; // 10 min fallback
const FLUSH_DEBOUNCE_MS = 30 * 1000; // 30 seconds

export class FeedCacheService {
  #dataService;
  #logger;

  /** @type {Map<string, { items: Object[], fetchedAt: string }>} */
  #cache = new Map();

  /** @type {Map<string, boolean>} tracks in-flight refreshes */
  #refreshing = new Map();

  #hydrated = false;
  #flushTimer = null;
  #dirty = false;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - DataService for YAML I/O
   * @param {Object} [config.logger]
   */
  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Get cached items for a source, using stale-while-revalidate strategy.
   *
   * @param {string} sourceKey - Source identifier (e.g. 'reddit', 'youtube')
   * @param {Function} fetchFn - Async function that returns items when called
   * @param {string} username - User identifier (for disk persistence path)
   * @param {Object} [options]
   * @param {boolean} [options.noCache] - Bypass cache, force fresh fetch
   * @returns {Promise<Object[]>} Cached or freshly fetched items
   */
  async getItems(sourceKey, fetchFn, username, { noCache = false } = {}) {
    this.#hydrateIfNeeded(username);

    if (noCache) {
      return this.#fetchAndCache(sourceKey, fetchFn, username);
    }

    const entry = this.#cache.get(sourceKey);
    if (!entry) {
      // Cold start for this source — must await
      return this.#fetchAndCache(sourceKey, fetchFn, username);
    }

    const age = Date.now() - new Date(entry.fetchedAt).getTime();
    const ttl = DEFAULT_TTLS[sourceKey] ?? DEFAULT_TTL;

    if (age < ttl) {
      // Fresh — serve from cache
      return entry.items;
    }

    // Stale — serve cached, trigger background refresh
    this.#backgroundRefresh(sourceKey, fetchFn, username);
    return entry.items;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  /**
   * Hydrate in-memory cache from disk on first access.
   */
  #hydrateIfNeeded(username) {
    if (this.#hydrated) return;
    this.#hydrated = true;

    try {
      const data = this.#dataService.user.read(CACHE_PATH, username);
      if (data && typeof data === 'object') {
        for (const [key, entry] of Object.entries(data)) {
          if (entry?.items && entry?.fetchedAt) {
            this.#cache.set(key, {
              items: entry.items,
              fetchedAt: entry.fetchedAt,
            });
          }
        }
        this.#logger.info?.('feed.cache.hydrated', {
          sources: this.#cache.size,
          keys: [...this.#cache.keys()],
        });
      }
    } catch (err) {
      this.#logger.warn?.('feed.cache.hydrate.error', { error: err.message });
    }
  }

  /**
   * Fetch from source, update cache, schedule disk flush.
   */
  async #fetchAndCache(sourceKey, fetchFn, username) {
    try {
      const items = await fetchFn();
      this.#cache.set(sourceKey, {
        items,
        fetchedAt: new Date().toISOString(),
      });
      this.#scheduleDiskFlush(username);
      return items;
    } catch (err) {
      this.#logger.warn?.('feed.cache.fetch.error', { sourceKey, error: err.message });
      // Return stale cache if available
      const stale = this.#cache.get(sourceKey);
      if (stale) {
        this.#logger.info?.('feed.cache.serving.stale', { sourceKey });
        return stale.items;
      }
      return [];
    }
  }

  /**
   * Background refresh — fire and forget, no await.
   */
  #backgroundRefresh(sourceKey, fetchFn, username) {
    if (this.#refreshing.get(sourceKey)) return; // already in-flight
    this.#refreshing.set(sourceKey, true);

    this.#fetchAndCache(sourceKey, fetchFn, username)
      .finally(() => this.#refreshing.delete(sourceKey));
  }

  /**
   * Debounced disk flush — writes full cache to _cache.yml at most once per 30s.
   */
  #scheduleDiskFlush(username) {
    this.#dirty = true;
    if (this.#flushTimer) return; // already scheduled

    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      if (!this.#dirty) return;
      this.#dirty = false;
      this.#flushToDisk(username);
    }, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Write full cache to disk as YAML.
   */
  #flushToDisk(username) {
    try {
      const data = {};
      for (const [key, entry] of this.#cache.entries()) {
        data[key] = {
          fetchedAt: entry.fetchedAt,
          items: entry.items,
        };
      }
      this.#dataService.user.write(CACHE_PATH, data, username);
      this.#logger.debug?.('feed.cache.flushed', { sources: Object.keys(data).length });
    } catch (err) {
      this.#logger.warn?.('feed.cache.flush.error', { error: err.message });
    }
  }
}

export default FeedCacheService;
