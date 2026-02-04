/**
 * ContentQueryAliasResolver - Resolves content query aliases to source configurations
 *
 * This service handles the resolution of content query prefixes (like "music:", "photos:")
 * to their underlying intent, sources, and gatekeepers.
 *
 * Resolution priority:
 * 1. User config (custom aliases, overrides, tag-type mappings, mapTo shorthand)
 * 2. Built-in aliases (music, photos, video, audiobooks)
 * 3. Pass-through to registry (provider, category, source)
 *
 * @example
 * const resolver = new ContentQueryAliasResolver({ registry, configService });
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
  #registry;
  #configService;
  #householdId;

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
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} deps.registry
   * @param {import('#system/config/ConfigService.mjs').ConfigService} deps.configService
   * @param {string} [deps.householdId] - Household ID for user config lookup
   */
  constructor({ registry, configService, householdId = null }) {
    this.#registry = registry;
    this.#configService = configService;
    this.#householdId = householdId;
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
    const aliasConfig = this.#configService.getAppConfig('content', 'aliases');
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
      const adapter = this.#registry.get(alias.mapToSource);
      sources = adapter ? [alias.mapToSource] : [];
    } else if (alias.mapToProvider) {
      const adapters = this.#registry.getByProvider(alias.mapToProvider);
      sources = adapters.map(a => a.source);
    } else if (alias.mapToCategory) {
      const adapters = this.#registry.getByCategory(alias.mapToCategory);
      sources = adapters.map(a => a.source);
    } else if (alias.preferLibraryType || alias.preferMediaType) {
      // Use all sources, will be filtered by gatekeeper
      sources = this.#registry.list();
    } else {
      // Default to all sources
      sources = this.#registry.list();
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
   * Resolve prefix directly from registry (provider, category, or source).
   *
   * @param {string} prefix - Normalized prefix
   * @returns {ResolvedQuery}
   * @private
   */
  #resolveFromRegistry(prefix) {
    // Try exact source match first
    const exactAdapter = this.#registry.get(prefix);
    if (exactAdapter) {
      logger.debug('content-query-alias.resolve.exactSource', { prefix });
      return {
        intent: `source-${prefix}`,
        sources: [prefix],
        gatekeeper: null,
        libraryFilter: {},
        originalPrefix: prefix,
        isRegistryResolved: true
      };
    }

    // Try provider match
    const byProvider = this.#registry.getByProvider(prefix);
    if (byProvider.length > 0) {
      logger.debug('content-query-alias.resolve.provider', {
        prefix,
        sourceCount: byProvider.length
      });
      return {
        intent: `provider-${prefix}`,
        sources: byProvider.map(a => a.source),
        gatekeeper: null,
        libraryFilter: {},
        originalPrefix: prefix,
        isRegistryResolved: true
      };
    }

    // Try category match
    const byCategory = this.#registry.getByCategory(prefix);
    if (byCategory.length > 0) {
      logger.debug('content-query-alias.resolve.category', {
        prefix,
        sourceCount: byCategory.length
      });
      return {
        intent: `category-${prefix}`,
        sources: byCategory.map(a => a.source),
        gatekeeper: null,
        libraryFilter: {},
        originalPrefix: prefix,
        isRegistryResolved: true
      };
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
      sources: this.#registry.list(),
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
    const userAliases = this.#configService.getAppConfig('content', 'aliases') || {};
    const userKeys = Object.keys(userAliases).filter(k => !k.startsWith('_'));

    // Combine and deduplicate
    return [...new Set([...builtIn, ...userKeys])];
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
