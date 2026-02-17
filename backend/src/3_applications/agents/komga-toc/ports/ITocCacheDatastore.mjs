// backend/src/3_applications/agents/komga-toc/ports/ITocCacheDatastore.mjs

/**
 * ITocCacheDatastore — port interface for TOC cache persistence.
 *
 * Abstracts how TOC extraction results and query config are stored,
 * so the agent never touches file paths, DataService, or YAML.
 *
 * @module applications/agents/komga-toc/ports/ITocCacheDatastore
 */
export class ITocCacheDatastore {
  /**
   * Read cached TOC data for a book.
   * @param {string} bookId
   * @returns {Object|null} Cached TOC object or null
   */
  readCache(bookId) {
    throw new Error('ITocCacheDatastore.readCache must be implemented');
  }

  /**
   * Write TOC data to cache.
   * @param {string} bookId
   * @param {Object} tocData
   */
  writeCache(bookId, tocData) {
    throw new Error('ITocCacheDatastore.writeCache must be implemented');
  }

  /**
   * Read query configuration (series list, recent_issues count).
   * @returns {Object|null} Config with params.series[] and params.recent_issues
   */
  readQueryConfig() {
    throw new Error('ITocCacheDatastore.readQueryConfig must be implemented');
  }
}

export function isTocCacheDatastore(obj) {
  return obj &&
    typeof obj.readCache === 'function' &&
    typeof obj.writeCache === 'function' &&
    typeof obj.readQueryConfig === 'function';
}
