/**
 * ContentQueryAliasResolver - Resolves content query aliases to source configurations
 *
 * This service handles the resolution of content query prefixes (like "music:", "photos:")
 * to their underlying intent, sources, and gatekeepers.
 *
 * Resolution priority:
 * 1. User config (custom aliases, overrides, tag-type mappings, mapTo shorthand)
 * 2. Built-in aliases (music, photos, video, audiobooks)
 * 3. Registry match (exact source, provider, category)
 * 4. Content-prefix aliases (from content-prefixes.yml, e.g., primary → singalong)
 * 5. Passthrough (all sources, no filtering)
 *
 * @example
 * const resolver = new ContentQueryAliasResolver({ contentCatalog, loadUserAliases });
 * const result = resolver.resolveContentQuery('music');
 * // { intent: 'audio-for-listening', sources: [...], gatekeeper: fn, ... }
 */

import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({
  source: 'backend',
  app: 'content-query-alias'
});

/**
 * @typedef {Object} AliasDefinition
 * @property {string} [intent] - Semantic intent (e.g., 'audio-for-listening')
 * @property {string} [preferMediaType] - Preferred media type filter (audio, video)
 * @property {string} [preferLibraryType] - Preferred library type (music, movie, show)
 * @property {string[]} [exclude] - Content types to exclude
 * @property {string[]} [include] - Content types to include exclusively
 * @property {string} [mapToCategory] - Map to a registry category
 * @property {string} [mapToProvider] - Map to a registry provider
 * @property {string} [mapToSource] - Map to a specific source
 */

/**
 * @typedef {Object} ResolvedQuery
 * @property {string} intent - Resolved intent for the query
 * @property {string[]} sources - Array of source names to query
 * @property {Function|null} gatekeeper - Filter function for content types
 * @property {Object} libraryFilter - Filter criteria for libraries
 * @property {string} [originalPrefix] - The original prefix that was resolved
 * @property {boolean} [isBuiltIn] - Whether resolved from built-in alias
 * @property {boolean} [isUserDefined] - Whether resolved from user config
 */

export class ContentQueryAliasResolver {
  #contentCatalog;
  #loadUserAliases;
  #householdId;
  #prefixAliases;

  /**
   * Built-in aliases for common content query patterns.
   * These can be overridden by user configuration.
   */
  #builtInAliases = {
    music: {
      intent: 'audio-for-listening',
      preferMediaType: 'audio',
      preferLibraryType: 'music',
      exclude: ['audiobook', 'podcast'],
    },
    photos: {
      intent: 'visual-gallery',
      mapToCategory: 'gallery',
    },
    video: {
      intent: 'watchable-content',
      preferMediaType: 'video',
    },
    audiobooks: {
      intent: 'spoken-narrative',
      preferMediaType: 'audio',
      include: ['audiobook'],
    },
  };

  /**
   * @param {Object} deps
   * @param {import('../ports/IContentCatalogGateway.mjs')} deps.contentCatalog
   * @param {Function} deps.loadUserAliases - Semantic alias projection
   * @param {string} [deps.householdId] - Household ID for user config lookup
   * @param {Object<string, string>} [deps.prefixAliases={}] - Map of prefix names to source:collection strings from content-prefixes.yml
   */
  constructor({ contentCatalog, loadUserAliases = () => ({}), householdId = null, prefixAliases = {} }) {
    if (!contentCatalog?.resolveQueryScope) {
      throw new Error('ContentQueryAliasResolver requires contentCatalog');
    }
    this.#contentCatalog = contentCatalog;
    this.#loadUserAliases = loadUserAliases;
    this.#householdId = householdId;
    this.#prefixAliases = prefixAliases;
  }

  /**
   * Resolve a content query prefix to its full configuration.
   *
   * @param {string} prefix - The query prefix (e.g., 'music', 'photos', 'plex')
   * @returns {ResolvedQuery} Resolved query configuration
   */
  resolveContentQuery(prefix) {
    if (!prefix || typeof prefix !== 'string') {
      logger.warn('content-query-alias.resolve.invalidPrefix', { prefix });
      return this.#createPassthroughResult(prefix);
    }

    const normalizedPrefix = prefix.toLowerCase().trim();

    // 1. Check user config for custom/override alias
    const userAlias = this.#getUserAlias(normalizedPrefix);
    if (userAlias) {
      logger.debug('content-query-alias.resolve.userAlias', {
        prefix: normalizedPrefix,
        alias: userAlias
      });
      return this.#resolveAlias(normalizedPrefix, userAlias, { isUserDefined: true });
    }

    // 2. Check built-in aliases
    const builtInAlias = this.#builtInAliases[normalizedPrefix];
    if (builtInAlias) {
      logger.debug('content-query-alias.resolve.builtIn', {
        prefix: normalizedPrefix,
        intent: builtInAlias.intent
      });
      return this.#resolveAlias(normalizedPrefix, builtInAlias, { isBuiltIn: true });
    }

    // 3. Pass through to registry resolution
    return this.#resolveFromRegistry(normalizedPrefix);
  }

  /**
   * Get user-defined alias from config.
   * Checks for tag type mappings, mapTo shorthand, and override definitions.
   *
   * @param {string} prefix - Normalized prefix
   * @returns {AliasDefinition|null}
   * @private
   */
  #getUserAlias(prefix) {
    // Get content aliases from app config
    const aliasConfig = this.#loadUserAliases(this.#householdId);
    if (!aliasConfig) return null;

    // Direct alias definition
    const directAlias = aliasConfig[prefix];
    if (directAlias) {
      // Handle shorthand mapTo string
      if (typeof directAlias === 'string') {
        return this.#parseMapToShorthand(directAlias);
      }
      return directAlias;
    }

    // Check tag-type mappings (e.g., "workout" -> maps to specific libraries)
    const tagMappings = aliasConfig._tagTypes || {};
    if (tagMappings[prefix]) {
      return {
        intent: `tag-type-${prefix}`,
        tagType: prefix,
        ...tagMappings[prefix]
      };
    }

    return null;
  }

  /**
   * Parse mapTo shorthand string to alias definition.
   * Supports: "category:gallery", "provider:plex", "source:plex-movies"
   *
   * @param {string} shorthand - Shorthand string
   * @returns {AliasDefinition}
   * @private
   */
  #parseMapToShorthand(shorthand) {
    if (!shorthand.includes(':')) {
      // Assume it's a category
      return { mapToCategory: shorthand };
    }

    const [type, value] = shorthand.split(':');
    switch (type) {
      case 'category':
        return { mapToCategory: value };
      case 'provider':
        return { mapToProvider: value };
      case 'source':
        return { mapToSource: value };
      default:
        logger.warn('content-query-alias.parseShorthand.unknownType', { type, shorthand });
        return { mapToCategory: shorthand };
    }
  }

  /**
   * Resolve an alias definition to a full query result.
   *
   * @param {string} prefix - Original prefix
   * @param {AliasDefinition} alias - Alias definition
   * @param {Object} metadata - Additional metadata (isBuiltIn, isUserDefined)
   * @returns {ResolvedQuery}
   * @private
   */
  #resolveAlias(prefix, alias, metadata = {}) {
    // Determine sources based on mapTo directives
    let sources = [];

    if (alias.mapToSource) {
      sources = this.#contentCatalog.resolveQueryScope(alias.mapToSource, 'source').sources;
    } else if (alias.mapToProvider) {
      sources = this.#contentCatalog.resolveQueryScope(alias.mapToProvider, 'provider').sources;
    } else if (alias.mapToCategory) {
      sources = this.#contentCatalog.resolveQueryScope(alias.mapToCategory, 'category').sources;
    } else if (alias.preferLibraryType || alias.preferMediaType) {
      // Use all sources, will be filtered by gatekeeper
      sources = this.#contentCatalog.sourceNames();
    } else {
      // Default to all sources
      sources = this.#contentCatalog.sourceNames();
    }

    // Build gatekeeper function
    const gatekeeper = this.#buildGatekeeper(alias);

    // Build library filter
    const libraryFilter = this.#buildLibraryFilter(alias);

    return {
      intent: alias.intent || `query-${prefix}`,
      sources,
      gatekeeper,
      libraryFilter,
      originalPrefix: prefix,
      ...metadata
    };
  }

  /**
   * Build a gatekeeper function from alias include/exclude rules.
   *
   * @param {AliasDefinition} alias - Alias definition
   * @returns {Function|null} Gatekeeper function or null if no filtering needed
   * @private
   */
  #buildGatekeeper(alias) {
    const { exclude, include, preferMediaType } = alias;

    // No filtering needed
    if (!exclude && !include && !preferMediaType) {
      return null;
    }

    return (item) => {
      const contentType = item.contentType || item.type;
      const mediaType = item.mediaType || item.metadata?.mediaType;

      // Include filter: only allow specific content types
      if (include && include.length > 0) {
        if (!include.includes(contentType)) {
          return false;
        }
      }

      // Exclude filter: reject specific content types
      if (exclude && exclude.length > 0) {
        if (exclude.includes(contentType)) {
          return false;
        }
      }

      // Media type preference filter
      if (preferMediaType) {
        if (mediaType && mediaType !== preferMediaType) {
          return false;
        }
      }

      return true;
    };
  }

  /**
   * Build library filter criteria from alias definition.
   *
   * @param {AliasDefinition} alias - Alias definition
   * @returns {Object} Library filter criteria
   * @private
   */
  #buildLibraryFilter(alias) {
    const filter = {};

    if (alias.preferLibraryType) {
      filter.libraryType = alias.preferLibraryType;
    }

    if (alias.preferMediaType) {
      filter.mediaType = alias.preferMediaType;
    }

    if (alias.tagType) {
      filter.tagType = alias.tagType;
    }

    return filter;
  }

  /**
   * Resolve prefix against the semantic catalog scope (source, provider, or category).
   *
   * @param {string} prefix - Normalized prefix
   * @returns {ResolvedQuery}
   * @private
   */
  #resolveFromRegistry(prefix) {
    const scope = this.#contentCatalog.resolveQueryScope(prefix);
    if (scope.sources.length > 0) {
      logger.debug(`content-query-alias.resolve.${scope.kind}`, {
        prefix,
        sourceCount: scope.sources.length
      });
      return {
        intent: `${scope.kind}-${prefix}`,
        sources: scope.sources,
        gatekeeper: null,
        libraryFilter: {},
        originalPrefix: prefix,
        isRegistryResolved: true
      };
    }

    // 4. Check content-prefixes.yml aliases (e.g., primary → singalong:primary)
    const prefixMapping = this.#prefixAliases[prefix];
    if (prefixMapping) {
      const [source] = prefixMapping.split(':');
      if (this.#contentCatalog.hasSource(source)) {
        logger.debug('content-query-alias.resolve.prefixAlias', {
          prefix,
          mapping: prefixMapping,
          source
        });
        return {
          intent: `prefix-alias-${prefix}`,
          sources: [source],
          gatekeeper: null,
          libraryFilter: {},
          originalPrefix: prefix,
          isPrefixAlias: true
        };
      }
    }

    // No match found - return passthrough result
    logger.debug('content-query-alias.resolve.passthrough', { prefix });
    return this.#createPassthroughResult(prefix);
  }

  /**
   * Create a passthrough result for unrecognized prefixes.
   * Uses all sources with no filtering.
   *
   * @param {string} prefix - Original prefix
   * @returns {ResolvedQuery}
   * @private
   */
  #createPassthroughResult(prefix) {
    return {
      intent: 'unknown',
      sources: this.#contentCatalog.sourceNames(),
      gatekeeper: null,
      libraryFilter: {},
      originalPrefix: prefix || null,
      isPassthrough: true
    };
  }

  /**
   * Get all available alias names (built-in + user-defined).
   *
   * @returns {string[]} Array of available alias names
   */
  getAvailableAliases() {
    const builtIn = Object.keys(this.#builtInAliases);
    const userAliases = this.#loadUserAliases(this.#householdId) || {};
    const userKeys = Object.keys(userAliases).filter(k => !k.startsWith('_'));

    const prefixKeys = Object.keys(this.#prefixAliases);

    // Combine and deduplicate
    return [...new Set([...builtIn, ...userKeys, ...prefixKeys])];
  }

  /**
   * Check if a prefix is a recognized alias.
   *
   * @param {string} prefix - Prefix to check
   * @returns {boolean}
   */
  isAlias(prefix) {
    if (!prefix) return false;
    const normalized = prefix.toLowerCase().trim();

    // Check built-in
    if (this.#builtInAliases[normalized]) return true;

    // Check user config
    if (this.#getUserAlias(normalized)) return true;

    // Check content-prefix aliases
    if (this.#prefixAliases[normalized]) return true;

    return false;
  }

  /**
   * Get the built-in alias definitions (for debugging/documentation).
   *
   * @returns {Object} Built-in alias definitions
   */
  getBuiltInAliases() {
    return { ...this.#builtInAliases };
  }
}

export default ContentQueryAliasResolver;
