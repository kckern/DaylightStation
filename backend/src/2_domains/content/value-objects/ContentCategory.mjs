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
 * - LIST (40): Menus, programs, watchlists as content sources
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
  LIST: 'list',
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
  [ContentCategory.LIST]: 40,
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
 * Tiebreak weights, used when a search HAS text.
 *
 * The scores above (10..150) are a browse ordering: with no search text, the
 * only signal available is what kind of thing an item is, so a show should
 * outrank a loose episode. They are the wrong scale for a text search, where
 * they dwarf any match signal — an EPISODE (20) with a perfect exact-title
 * match could never reach a WORK (130) that merely contained the term inside
 * a long subtitle, which made episodes, tracks and image files unreachable by
 * search regardless of how well they matched.
 *
 * These weights preserve the same ORDER on a single-digit scale, so category
 * only separates items whose match quality already ties.
 * @type {Object<string, number>}
 */
const CATEGORY_TIEBREAKS = Object.freeze({
  [ContentCategory.IDENTITY]: 9,
  [ContentCategory.CURATED]: 8,
  [ContentCategory.CREATOR]: 7,
  [ContentCategory.SERIES]: 6,
  [ContentCategory.WORK]: 5,
  [ContentCategory.CONTAINER]: 4,
  [ContentCategory.LIST]: 3,
  [ContentCategory.EPISODE]: 2,
  [ContentCategory.TRACK]: 1,
  [ContentCategory.MEDIA]: 0
});

/**
 * Get the relevance score for a category
 * @param {string} category
 * @returns {number}
 */
export function getCategoryScore(category) {
  return CATEGORY_SCORES[category] ?? 5;
}

/**
 * Get the single-digit tiebreak weight for a category, for use alongside a
 * text-match score. Preserves the ordering of getCategoryScore at a magnitude
 * that cannot override match quality.
 * @param {string} category
 * @returns {number}
 */
export function getCategoryTiebreak(category) {
  return CATEGORY_TIEBREAKS[category] ?? 0;
}

export default ContentCategory;
