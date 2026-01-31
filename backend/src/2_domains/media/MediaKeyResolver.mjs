import { UnknownMediaSourceError, UnresolvableMediaKeyError } from './errors.mjs';

/**
 * Resolves bare media keys to compound format (source:id) using context-aware heuristics.
 *
 * Media keys can be:
 * - Bare: "11282" (just an ID)
 * - Compound: "plex:11282" (source:id format)
 *
 * The resolver normalizes bare keys to compound format based on:
 * 1. App-specific configuration (defaultSource, patterns)
 * 2. Pattern matching against regex rules
 * 3. Fallback chain of sources
 *
 * @class MediaKeyResolver
 */
export class MediaKeyResolver {
  /**
   * Creates a new MediaKeyResolver instance.
   *
   * @param {Object} config - Configuration options
   * @param {string[]} config.knownSources - List of valid source prefixes
   * @param {Object} config.defaults - Default resolution rules
   * @param {Array} config.defaults.patterns - Pattern matching rules [{match, source}]
   * @param {string[]} config.defaults.fallbackChain - Ordered list of sources to try
   * @param {Object} config.apps - Per-app configuration overrides
   */
  constructor(config = {}) {
    this.knownSources = config.knownSources || ['plex', 'folder', 'filesystem'];
    this.defaults = config.defaults || {
      patterns: [{ match: '^\\d+$', source: 'plex' }],
      fallbackChain: ['plex', 'folder', 'filesystem']
    };
    this.apps = config.apps || {};
  }

  /**
   * Checks if a key is already in compound format (source:id).
   * A key is compound if it has a colon and the prefix is a known source.
   *
   * @param {string} key - The media key to check
   * @returns {boolean} True if the key is in compound format with a known source
   */
  isCompound(key) {
    if (key == null || typeof key !== 'string') {
      return false;
    }

    const colonIndex = key.indexOf(':');
    if (colonIndex === -1) {
      return false;
    }

    const source = key.substring(0, colonIndex);
    return this.knownSources.includes(source);
  }

  /**
   * Parses a compound key into its source and id components.
   * Handles IDs that contain colons by only splitting on the first colon.
   *
   * @param {string} compoundKey - The compound key to parse
   * @returns {{ source: string, id: string }} The parsed components
   */
  parse(compoundKey) {
    if (compoundKey == null || typeof compoundKey !== 'string') {
      return { source: '', id: '' };
    }

    const colonIndex = compoundKey.indexOf(':');
    if (colonIndex === -1) {
      return { source: '', id: compoundKey };
    }

    return {
      source: compoundKey.substring(0, colonIndex),
      id: compoundKey.substring(colonIndex + 1)
    };
  }

  /**
   * Gets resolution rules for a specific app, merging app-specific config with defaults.
   *
   * @param {string|null} appContext - The app context name
   * @returns {Object} The merged resolution rules with patterns and fallbackChain
   */
  getRulesForApp(appContext) {
    const appConfig = appContext && this.apps[appContext] ? this.apps[appContext] : {};

    return {
      defaultSource: appConfig.defaultSource || null,
      patterns: appConfig.patterns || this.defaults.patterns || [],
      fallbackChain: appConfig.fallbackChain || this.defaults.fallbackChain || []
    };
  }

  /**
   * Matches a key against an array of pattern rules.
   *
   * @private
   * @param {string} key - The key to match
   * @param {Array} patterns - Array of pattern objects with {match, source}
   * @returns {string|null} The source from the first matching pattern, or null
   */
  _matchPattern(key, patterns) {
    if (!key || !Array.isArray(patterns)) {
      return null;
    }

    for (const pattern of patterns) {
      if (!pattern || !pattern.match || !pattern.source) {
        continue;
      }

      try {
        const regex = new RegExp(pattern.match);
        if (regex.test(key)) {
          return pattern.source;
        }
      } catch {
        // Invalid regex, skip this pattern
        continue;
      }
    }

    return null;
  }

  /**
   * Resolves a media key to compound format.
   *
   * Resolution order:
   * 1. If already compound with known source, return as-is
   * 2. If has colon but unknown source, throw UnknownMediaSourceError
   * 3. If app has defaultSource, use it
   * 4. Pattern match against configured patterns
   * 5. Use first source from fallback chain
   * 6. Throw UnresolvableMediaKeyError if nothing works
   *
   * @param {string} key - The media key to resolve
   * @param {string|null} appContext - Optional app context for app-specific rules
   * @returns {string} The resolved compound key (source:id)
   * @throws {UnknownMediaSourceError} If key has unknown source prefix
   * @throws {UnresolvableMediaKeyError} If key cannot be resolved
   */
  resolve(key, appContext = null) {
    // Handle null/undefined
    if (key == null) {
      throw new UnresolvableMediaKeyError(key, appContext);
    }

    // Convert to string if not already
    const keyStr = String(key);

    // Check if already compound
    if (this.isCompound(keyStr)) {
      return keyStr;
    }

    // Check for unknown source prefix
    const colonIndex = keyStr.indexOf(':');
    if (colonIndex !== -1) {
      const source = keyStr.substring(0, colonIndex);
      throw new UnknownMediaSourceError(source, this.knownSources);
    }

    // Get rules for this app context
    const rules = this.getRulesForApp(appContext);

    // Try app's default source
    if (rules.defaultSource) {
      return `${rules.defaultSource}:${keyStr}`;
    }

    // Try pattern matching
    const matchedSource = this._matchPattern(keyStr, rules.patterns);
    if (matchedSource) {
      return `${matchedSource}:${keyStr}`;
    }

    // Try fallback chain
    if (rules.fallbackChain && rules.fallbackChain.length > 0) {
      return `${rules.fallbackChain[0]}:${keyStr}`;
    }

    // Nothing worked
    throw new UnresolvableMediaKeyError(keyStr, appContext);
  }

  /**
   * Attempts to resolve a media key without throwing errors.
   *
   * @param {string} key - The media key to resolve
   * @param {string|null} appContext - Optional app context for app-specific rules
   * @returns {string|null} The resolved compound key, or null if resolution fails
   */
  tryResolve(key, appContext = null) {
    try {
      return this.resolve(key, appContext);
    } catch {
      return null;
    }
  }

  /**
   * Forces resolution with an explicit source, bypassing patterns.
   *
   * @param {string} key - The media key to resolve
   * @param {string} source - The source to use
   * @returns {string} The compound key (source:id)
   * @throws {UnknownMediaSourceError} If source is not in knownSources
   */
  resolveAs(key, source) {
    if (!this.knownSources.includes(source)) {
      throw new UnknownMediaSourceError(source, this.knownSources);
    }

    // Handle null/undefined key
    if (key == null) {
      return `${source}:`;
    }

    const keyStr = String(key);

    // If already compound, extract the ID and re-prefix with new source
    if (this.isCompound(keyStr)) {
      const { id } = this.parse(keyStr);
      return `${source}:${id}`;
    }

    // If has colon but not compound (unknown source), extract after colon as ID
    const colonIndex = keyStr.indexOf(':');
    if (colonIndex !== -1) {
      const id = keyStr.substring(colonIndex + 1);
      return `${source}:${id}`;
    }

    // Bare key, just prefix
    return `${source}:${keyStr}`;
  }
}

export default MediaKeyResolver;
