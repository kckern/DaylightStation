// backend/src/4_api/v1/parsers/contentQueryParser.mjs

import { parseDuration, parseTime } from './rangeParser.mjs';

/**
 * Query parameter aliases for normalization.
 */
export const QUERY_ALIASES = {
  // Sort aliases - all map to 'random'
  sort: {
    shuffle: 'random',
    rand: 'random',
  },
  // Source aliases
  source: {
    photos: 'gallery',
    images: 'gallery',
    videos: 'media',
    books: 'readable',
    audiobooks: 'readable',
  },
};

/**
 * Boolean params that can be expressed as key-only or truthy values.
 */
const BOOLEAN_PARAMS = ['shuffle', 'favorites', 'random'];

/**
 * Values considered truthy for boolean params.
 */
const BOOLEAN_TRUTHY = ['1', 'true', 'yes', ''];

/**
 * Canonical filter keys that are passed through.
 */
const CANONICAL_KEYS = [
  'text', 'person', 'creator', 'time', 'timeFrom', 'timeTo',
  'duration', 'durationMin', 'durationMax', 'mediaType',
  'capability', 'tags', 'resolution', 'rating', 'from'
];

/**
 * Check if a key exists in an object (including with empty value).
 * @param {Object} obj
 * @param {string} key
 * @returns {boolean}
 */
function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Check if a value is truthy for boolean params.
 * @param {*} value
 * @returns {boolean}
 */
function isTruthy(value) {
  if (value === undefined) return false;
  return BOOLEAN_TRUTHY.includes(String(value).toLowerCase());
}

/**
 * Parse raw HTTP query params into a normalized ContentQuery object.
 * Handles aliases, boolean coercion, and adapter-specific key passthrough.
 *
 * @param {Object} rawParams - Raw query parameters from Express req.query
 * @returns {Object} Normalized ContentQuery object
 */
export function parseContentQuery(rawParams) {
  const query = {};

  // Source (with alias support)
  const source = rawParams.source ?? rawParams.src;
  if (source) {
    query.source = QUERY_ALIASES.source[source] ?? source;
  }

  // Sort normalization
  let sort = rawParams.sort;
  if (!sort && hasKey(rawParams, 'shuffle')) {
    sort = 'random';
  }
  if (!sort && hasKey(rawParams, 'random')) {
    sort = 'random';
  }
  if (sort) {
    query.sort = QUERY_ALIASES.sort[sort] ?? sort;
  }

  // Pick (for random container selection)
  if (rawParams.pick) {
    query.pick = rawParams.pick;
  }

  // Boolean params
  if (isTruthy(rawParams.shuffle) || hasKey(rawParams, 'shuffle')) {
    query.sort = 'random';
  }
  if (isTruthy(rawParams.favorites) || hasKey(rawParams, 'favorites')) {
    query.favorites = true;
  }

  // Canonical filters (pass through)
  for (const key of CANONICAL_KEYS) {
    if (rawParams[key] !== undefined) {
      query[key] = rawParams[key];
    }
  }

  // Parse duration if present
  if (query.duration) {
    const parsed = parseDuration(query.duration);
    if (parsed) query.duration = parsed;
  }

  // Parse time if present
  if (query.time) {
    const parsed = parseTime(query.time);
    if (parsed) query.time = parsed;
  }

  // Pagination (convert to numbers)
  if (rawParams.take !== undefined) {
    const take = parseInt(rawParams.take, 10);
    if (!isNaN(take)) query.take = take;
  }
  if (rawParams.skip !== undefined) {
    const skip = parseInt(rawParams.skip, 10);
    if (!isNaN(skip)) query.skip = skip;
  }

  // Adapter-specific keys (prefix.key format) - pass through
  for (const [key, value] of Object.entries(rawParams)) {
    if (key.includes('.')) {
      query[key] = value;
    }
  }

  return query;
}

/**
 * Validation errors for a query.
 * @typedef {Object} ValidationError
 * @property {string} field - Field that failed validation
 * @property {string} message - Error message
 */

/**
 * Validation result.
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether query is valid
 * @property {ValidationError[]} [errors] - Validation errors if invalid
 */

/**
 * Valid sort options.
 */
const VALID_SORT_OPTIONS = ['date', 'title', 'random'];

/**
 * Valid media types.
 */
const VALID_MEDIA_TYPES = ['image', 'video', 'audio'];

/**
 * Valid capabilities.
 */
const VALID_CAPABILITIES = ['playable', 'displayable', 'readable', 'listable'];

/**
 * Valid pick options.
 */
const VALID_PICK_OPTIONS = ['random'];

/**
 * Duration format regex: number, Nm, Nh, NhMm, or ranges with ..
 */
const DURATION_REGEX = /^(\d+[hm]?|\d+h\d+m?)?(\.\.)?(\d+[hm]?|\d+h\d+m?)?$/;

/**
 * Validate a normalized ContentQuery object.
 *
 * @param {Object} query - Normalized query object
 * @returns {ValidationResult}
 */
export function validateContentQuery(query) {
  const errors = [];

  // Sort validation
  if (query.sort && !VALID_SORT_OPTIONS.includes(query.sort)) {
    errors.push({
      field: 'sort',
      message: `Invalid sort: ${query.sort}. Must be one of: ${VALID_SORT_OPTIONS.join(', ')}`
    });
  }

  // Media type validation
  if (query.mediaType && !VALID_MEDIA_TYPES.includes(query.mediaType)) {
    errors.push({
      field: 'mediaType',
      message: `Invalid mediaType: ${query.mediaType}. Must be one of: ${VALID_MEDIA_TYPES.join(', ')}`
    });
  }

  // Capability validation
  if (query.capability && !VALID_CAPABILITIES.includes(query.capability)) {
    errors.push({
      field: 'capability',
      message: `Invalid capability: ${query.capability}. Must be one of: ${VALID_CAPABILITIES.join(', ')}`
    });
  }

  // Pick validation
  if (query.pick && !VALID_PICK_OPTIONS.includes(query.pick)) {
    errors.push({
      field: 'pick',
      message: `Invalid pick: ${query.pick}. Must be one of: ${VALID_PICK_OPTIONS.join(', ')}`
    });
  }

  // Duration format validation (skip if already parsed to object)
  if (query.duration && typeof query.duration === 'string' && !DURATION_REGEX.test(query.duration)) {
    errors.push({
      field: 'duration',
      message: `Invalid duration format: ${query.duration}. Use: 30, 3m, 1h, 1h30m, or ranges like 3m..10m`
    });
  }

  // Pagination bounds
  if (query.take !== undefined) {
    if (query.take < 1) {
      errors.push({ field: 'take', message: 'take must be at least 1' });
    }
    if (query.take > 1000) {
      errors.push({ field: 'take', message: 'take must be at most 1000' });
    }
  }

  if (query.skip !== undefined && query.skip < 0) {
    errors.push({ field: 'skip', message: 'skip must be non-negative' });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

export default { parseContentQuery, validateContentQuery, QUERY_ALIASES };
