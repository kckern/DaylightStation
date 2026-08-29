import { ValidationError } from '#domains/core/errors/index.mjs';

const VALID_MEDIA_TYPES = ['image', 'video', 'audio'];
const VALID_SORT_OPTIONS = ['date', 'title', 'random'];

/** Validate the domain values accepted by a media search query. */
export function validateSearchQuery(query) {
  if (query.mediaType && !VALID_MEDIA_TYPES.includes(query.mediaType)) {
    throw new ValidationError(`Invalid mediaType: ${query.mediaType}. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`, {
      code: 'INVALID_MEDIA_TYPE', field: 'mediaType', value: query.mediaType,
    });
  }
  if (query.sort && !VALID_SORT_OPTIONS.includes(query.sort)) {
    throw new ValidationError(`Invalid sort: ${query.sort}. Must be one of: ${VALID_SORT_OPTIONS.join(', ')}`, {
      code: 'INVALID_SORT', field: 'sort', value: query.sort,
    });
  }
  if (query.take !== undefined && query.take < 0) {
    throw new ValidationError('take must be positive', { code: 'INVALID_TAKE', field: 'take', value: query.take });
  }
  if (query.skip !== undefined && query.skip < 0) {
    throw new ValidationError('skip must be non-negative', { code: 'INVALID_SKIP', field: 'skip', value: query.skip });
  }
  if (query.ratingMin !== undefined && (query.ratingMin < 1 || query.ratingMin > 5)) {
    throw new ValidationError('ratingMin must be between 1 and 5', { code: 'INVALID_RATING', field: 'ratingMin', value: query.ratingMin });
  }
}
