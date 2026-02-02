// backend/src/2_domains/content/value-objects/ContentCategory.mjs

/**
 * ContentCategory Value Object
 *
 * Defines canonical content categories for relevance scoring.
 * Adapters map their internal types to these categories.
 *
 * Scoring tiers (higher = more relevant in search):
 * - IDENTITY (150): Face albums, user profiles - most specific match
 * - CURATED (148): Playlists, collections, tags, photo albums
 * - CREATOR (145): Artists, authors, directors
 * - SERIES (140): TV shows, podcast series
 * - WORK (130): Movies, standalone complete works
 * - CONTAINER (125): Music albums, generic containers
 * - EPISODE (20): Individual episodes
 * - TRACK (15): Individual tracks
 * - MEDIA (10): Images, videos, individual media files
 */

/**
 * @enum {string}
 */
export const ContentCategory = Object.freeze({
  IDENTITY: 'identity',
  CURATED: 'curated',
  CREATOR: 'creator',
  SERIES: 'series',
  WORK: 'work',
  CONTAINER: 'container',
  EPISODE: 'episode',
  TRACK: 'track',
  MEDIA: 'media'
});

/**
 * All valid content categories
 * @type {string[]}
 */
export const ALL_CONTENT_CATEGORIES = Object.freeze(Object.values(ContentCategory));

/**
 * Relevance scores for each category
 * @type {Object<string, number>}
 */
const CATEGORY_SCORES = Object.freeze({
  [ContentCategory.IDENTITY]: 150,
  [ContentCategory.CURATED]: 148,
  [ContentCategory.CREATOR]: 145,
  [ContentCategory.SERIES]: 140,
  [ContentCategory.WORK]: 130,
  [ContentCategory.CONTAINER]: 125,
  [ContentCategory.EPISODE]: 20,
  [ContentCategory.TRACK]: 15,
  [ContentCategory.MEDIA]: 10
});

/**
 * Check if a value is a valid content category
 * @param {string} category
 * @returns {boolean}
 */
export function isValidContentCategory(category) {
  return ALL_CONTENT_CATEGORIES.includes(category);
}

/**
 * Get the relevance score for a category
 * @param {string} category
 * @returns {number}
 */
export function getCategoryScore(category) {
  return CATEGORY_SCORES[category] ?? 5;
}

export default ContentCategory;
