/**
 * ContentQueryGatekeepers - Standalone filter functions for content query results
 *
 * Gatekeepers are pure filter functions that determine whether a content item
 * should be included in query results based on specific criteria. They are
 * designed to be composable and reusable across different content queries.
 *
 * @example
 * import { audioForListening, kidsSafe } from './ContentQueryGatekeepers.mjs';
 *
 * const results = items.filter(audioForListening);
 * const safeResults = items.filter(kidsSafe);
 */

/**
 * Gatekeeper for "audio-for-listening" intent.
 * Excludes audiobooks, podcasts, and spoken word content to return only music.
 *
 * @param {Object} item - Content item to evaluate
 * @param {string} [item.contentType] - Content type identifier
 * @param {string} [item.type] - Fallback type identifier
 * @returns {boolean} True if item should be included (is music/listening content)
 *
 * @example
 * const musicOnly = tracks.filter(audioForListening);
 */
export function audioForListening(item) {
  const EXCLUDED = ['audiobook', 'podcast', 'spoken'];
  const contentType = item.contentType || item.type;
  return !EXCLUDED.includes(contentType);
}

/**
 * Gatekeeper for kids-safe content.
 * Allows items explicitly tagged "kids" or with appropriate content ratings.
 *
 * @param {Object} item - Content item to evaluate
 * @param {string[]} [item.tags] - Array of tags associated with the item
 * @param {string} [item.rating] - Content rating (e.g., 'G', 'PG', 'TV-Y')
 * @returns {boolean} True if item is safe for kids
 *
 * @example
 * const safeForKids = movies.filter(kidsSafe);
 */
export function kidsSafe(item) {
  const SAFE_RATINGS = ['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG'];

  if (item.tags?.includes('kids')) return true;
  if (item.rating && SAFE_RATINGS.includes(item.rating)) return true;
  return false;
}

/**
 * Factory to create a custom exclude gatekeeper.
 * Returns a filter function that excludes items matching specified content types.
 *
 * @param {string[]} excludeTypes - Array of content types to exclude
 * @returns {Function} Gatekeeper function that returns false for excluded types
 *
 * @example
 * const noAudiobooks = createExcludeGatekeeper(['audiobook', 'podcast']);
 * const filteredItems = items.filter(noAudiobooks);
 */
export function createExcludeGatekeeper(excludeTypes) {
  return (item) => {
    const contentType = item.contentType || item.type;
    return !excludeTypes.includes(contentType);
  };
}

/**
 * Factory to create a custom include gatekeeper.
 * Returns a filter function that only includes items matching specified content types.
 *
 * @param {string[]} includeTypes - Array of content types to include
 * @returns {Function} Gatekeeper function that returns true only for included types
 *
 * @example
 * const moviesOnly = createIncludeGatekeeper(['movie', 'film']);
 * const filteredItems = items.filter(moviesOnly);
 */
export function createIncludeGatekeeper(includeTypes) {
  return (item) => {
    const contentType = item.contentType || item.type;
    return includeTypes.includes(contentType);
  };
}

/**
 * Default export with all gatekeeper functions for convenient access.
 */
export default {
  audioForListening,
  kidsSafe,
  createExcludeGatekeeper,
  createIncludeGatekeeper
};
