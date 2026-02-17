// backend/src/1_adapters/persistence/yaml/YamlDismissedItemsStore.mjs
/**
 * YamlDismissedItemsStore
 *
 * YAML-backed persistence for dismissed feed item IDs.
 * Stores itemId → unix timestamp (seconds). Auto-prunes entries older than 30 days on load.
 *
 * Path: common/feed/dismissed (DataService appends .yml)
 * Scope: household-shared (not per-user) since there's a single scroll user.
 *
 * @module adapters/persistence/yaml
 */

const DISMISSED_PATH = 'common/feed/dismissed';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export class YamlDismissedItemsStore {
  #dataService;
  #logger;
  /** @type {Set<string>|null} Cached set, loaded once per session */
  #cache = null;

  constructor({ dataService, logger = console }) {
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Load dismissed item IDs, pruning expired entries.
   * Caches result in memory for the session.
   * @returns {Set<string>}
   */
  load() {
    if (this.#cache) return this.#cache;

    const raw = this.#dataService.household.read(DISMISSED_PATH) || {};
    const now = Math.floor(Date.now() / 1000);
    const pruned = {};
    let prunedCount = 0;

    for (const [id, ts] of Object.entries(raw)) {
      if (now - ts <= MAX_AGE_SECONDS) {
        pruned[id] = ts;
      } else {
        prunedCount++;
      }
    }

    // Write back if we pruned anything
    if (prunedCount > 0) {
      this.#dataService.household.write(DISMISSED_PATH, pruned);
      this.#logger.info?.('feed.dismissed.pruned', { prunedCount });
    }

    this.#cache = new Set(Object.keys(pruned));
    return this.#cache;
  }

  /**
   * Add item IDs to the dismissed set.
   * @param {string[]} itemIds
   */
  add(itemIds) {
    if (!itemIds.length) return;

    const raw = this.#dataService.household.read(DISMISSED_PATH) || {};
    const now = Math.floor(Date.now() / 1000);

    for (const id of itemIds) {
      raw[id] = now;
    }

    this.#dataService.household.write(DISMISSED_PATH, raw);

    // Update cache if loaded
    if (this.#cache) {
      for (const id of itemIds) this.#cache.add(id);
    }

    this.#logger.debug?.('feed.dismissed.added', { count: itemIds.length });
  }

  /**
   * Clear the in-memory cache (called on pool reset).
   */
  clearCache() {
    this.#cache = null;
  }
}

export default YamlDismissedItemsStore;
