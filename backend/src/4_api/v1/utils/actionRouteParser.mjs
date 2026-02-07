/**
 * Action Route ID Parser
 *
 * Parses route parameters into normalized source/localId/compoundId.
 * Supports three ID formats:
 * - Path segments: /plex/12345 -> { source: 'plex', localId: '12345' }
 * - Compound ID: /plex:12345 -> { source: 'plex', localId: '12345' }
 * - Heuristic: /12345 -> { source: 'plex', localId: '12345' } (digits = plex)
 *
 * @module actionRouteParser
 */

import { parseModifiers } from './modifierParser.mjs';

/**
 * Known content sources in the system.
 * @type {string[]}
 */
const KNOWN_SOURCES = [
  'plex',
  'immich',
  'watchlist',
  'local',
  'files',
  'canvas',
  'audiobookshelf',
  'komga',
  'singalong',
  'readalong',
  'list'
];

/**
 * Source aliases that should be normalized.
 * @type {Object<string, string>}
 */
const SOURCE_ALIASES = {
  local: 'watchlist',
  media: 'files',
  singing: 'singalong',
  narrated: 'readalong',
  list: 'menu'
};

/**
 * UUID v4 pattern for detecting immich IDs.
 * @type {RegExp}
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * File extension pattern for detecting filesystem paths.
 * @type {RegExp}
 */
const FILE_EXTENSION_PATTERN = /\.[a-zA-Z0-9]{2,5}$/;

/**
 * Bare digits pattern for detecting plex IDs.
 * @type {RegExp}
 */
const DIGITS_ONLY_PATTERN = /^\d+$/;

/**
 * Normalize a source name by applying aliases.
 *
 * @param {string} source - The source name to normalize
 * @returns {string} The normalized source name
 */
function normalizeSource(source) {
  if (!source) return '';
  return SOURCE_ALIASES[source] || source;
}

/**
 * Check if a string is a known source.
 *
 * @param {string} str - The string to check
 * @returns {boolean} True if the string is a known source
 */
function isKnownSource(str) {
  if (!str) return false;
  return KNOWN_SOURCES.includes(str.toLowerCase());
}

/**
 * Detect the source type from a value using heuristics.
 *
 * @param {string} value - The value to analyze
 * @returns {string|null} The detected source type, or null if unknown
 */
function detectSourceHeuristically(value) {
  if (!value) return null;

  // Check if it's a bare digit string -> plex
  if (DIGITS_ONLY_PATTERN.test(value)) {
    return 'plex';
  }

  // Check if it's a UUID -> immich
  if (UUID_PATTERN.test(value)) {
    return 'immich';
  }

  // Check if it has a file extension -> files
  if (FILE_EXTENSION_PATTERN.test(value)) {
    return 'files';
  }

  return null;
}

/**
 * Parse action route parameters into a normalized ID structure.
 *
 * @param {Object} params - The route parameters
 * @param {string} [params.source] - The source parameter (may be compound ID or heuristic value)
 * @param {string} [params.path] - The path parameter (may contain localId and modifiers)
 * @returns {Object} Normalized ID structure
 * @returns {string} returns.source - The normalized source type
 * @returns {string} returns.localId - The local identifier within the source
 * @returns {string} returns.compoundId - The compound ID (source:localId)
 * @returns {Object} returns.modifiers - Extracted modifiers (shuffle, playable, recent_on_top)
 */
export function parseActionRouteId(params = {}) {
  let { source = '', path = '' } = params;

  // Handle empty/undefined inputs
  if (!source && !path) {
    return {
      source: '',
      localId: '',
      compoundId: '',
      modifiers: {}
    };
  }

  let localId = '';
  let modifiers = {};

  // Check if source contains a compound ID (source:localId)
  if (source && source.includes(':')) {
    const colonIndex = source.indexOf(':');
    const parsedSource = source.substring(0, colonIndex);
    const parsedLocalId = source.substring(colonIndex + 1);

    source = normalizeSource(parsedSource);
    localId = parsedLocalId;

    // If there's also a path, append it
    if (path) {
      const { modifiers: pathModifiers, localId: cleanPath } = parseModifiers(path);
      if (cleanPath) {
        localId = localId ? `${localId}/${cleanPath}` : cleanPath;
      }
      modifiers = pathModifiers;
    }
  } else if (isKnownSource(source)) {
    // Source is a known source, path contains localId and possibly modifiers
    source = normalizeSource(source);

    if (path) {
      const { modifiers: pathModifiers, localId: cleanPath } = parseModifiers(path);
      localId = cleanPath;
      modifiers = pathModifiers;
    }
  } else {
    // Source might be a heuristic value (bare digits, UUID, file path)
    const detectedSource = detectSourceHeuristically(source);

    if (detectedSource) {
      // The "source" param is actually the localId
      localId = source;
      source = detectedSource;

      // Parse any modifiers from path
      if (path) {
        const { modifiers: pathModifiers, localId: cleanPath } = parseModifiers(path);
        if (cleanPath) {
          localId = `${localId}/${cleanPath}`;
        }
        modifiers = pathModifiers;
      }
    } else {
      // Unknown pattern - treat as-is
      source = normalizeSource(source);
      if (path) {
        const { modifiers: pathModifiers, localId: cleanPath } = parseModifiers(path);
        localId = cleanPath;
        modifiers = pathModifiers;
      }
    }
  }

  // Build compound ID
  const compoundId = source ? `${source}:${localId}` : '';

  return {
    source,
    localId,
    compoundId,
    modifiers
  };
}

export default { parseActionRouteId };
