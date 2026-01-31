// backend/src/2_domains/media/IMediaSearchable.mjs
import { ValidationError } from '../core/errors/index.mjs';

/**
 * @typedef {Object} MediaSearchQuery
 * @property {string} [text] - Free text search (title, description)
 * @property {string[]} [people] - Person names or IDs
 * @property {string} [dateFrom] - ISO date start
 * @property {string} [dateTo] - ISO date end
 * @property {string} [location] - City, state, or country
 * @property {number[]} [coordinates] - [lat, lng] for geo search
 * @property {number} [radius] - Radius in km (with coordinates)
 * @property {'image'|'video'|'audio'} [mediaType] - Filter by type
 * @property {boolean} [favorites] - Only favorites
 * @property {number} [ratingMin] - Minimum rating (1-5)
 * @property {string[]} [tags] - Tag/label names
 * @property {number} [take] - Limit results
 * @property {number} [skip] - Offset for pagination
 * @property {'date'|'title'|'random'} [sort] - Sort order
 */

/**
 * @typedef {Object} MediaSearchResult
 * @property {Array} items - Matched items (ListableItem|PlayableItem|ViewableItem)
 * @property {number} total - Total matches (for pagination)
 * @property {Object} [facets] - Aggregations (people counts, date buckets)
 */

const VALID_MEDIA_TYPES = ['image', 'video', 'audio'];
const VALID_SORT_OPTIONS = ['date', 'title', 'random'];

/**
 * Check if an object implements IMediaSearchable
 * @param {Object} obj
 * @returns {boolean}
 */
export function isMediaSearchable(obj) {
  return (
    obj !== null &&
    obj !== undefined &&
    typeof obj === 'object' &&
    typeof obj.search === 'function' &&
    typeof obj.getSearchCapabilities === 'function'
  );
}

/**
 * Validate a search query object
 * @param {MediaSearchQuery} query
 * @throws {ValidationError} If query is invalid
 */
export function validateSearchQuery(query) {
  if (query.mediaType && !VALID_MEDIA_TYPES.includes(query.mediaType)) {
    throw new ValidationError(`Invalid mediaType: ${query.mediaType}. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`, {
      code: 'INVALID_MEDIA_TYPE',
      field: 'mediaType',
      value: query.mediaType
    });
  }

  if (query.sort && !VALID_SORT_OPTIONS.includes(query.sort)) {
    throw new ValidationError(`Invalid sort: ${query.sort}. Must be one of: ${VALID_SORT_OPTIONS.join(', ')}`, {
      code: 'INVALID_SORT',
      field: 'sort',
      value: query.sort
    });
  }

  if (query.take !== undefined && query.take < 0) {
    throw new ValidationError('take must be positive', {
      code: 'INVALID_TAKE',
      field: 'take',
      value: query.take
    });
  }

  if (query.skip !== undefined && query.skip < 0) {
    throw new ValidationError('skip must be non-negative', {
      code: 'INVALID_SKIP',
      field: 'skip',
      value: query.skip
    });
  }

  if (query.ratingMin !== undefined && (query.ratingMin < 1 || query.ratingMin > 5)) {
    throw new ValidationError('ratingMin must be between 1 and 5', {
      code: 'INVALID_RATING',
      field: 'ratingMin',
      value: query.ratingMin
    });
  }
}

/**
 * IMediaSearchable interface definition (for documentation)
 *
 * Adapters implementing this interface must provide:
 * - search(query: MediaSearchQuery): Promise<MediaSearchResult>
 * - getSearchCapabilities(): string[]
 */
export const IMediaSearchable = {
  /**
   * Search for media items matching query
   * @param {MediaSearchQuery} query
   * @returns {Promise<MediaSearchResult>}
   */
  async search(query) {
    throw new Error('Not implemented');
  },

  /**
   * Get available search capabilities for this adapter
   * @returns {string[]} - Supported query fields
   */
  getSearchCapabilities() {
    return [];
  }
};

export default { isMediaSearchable, validateSearchQuery, IMediaSearchable };
