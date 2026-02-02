// backend/src/3_applications/content/ContentQueryService.mjs

import { ItemSelectionService, RelevanceScoringService } from '#domains/content/index.mjs';

/**
 * Application service for orchestrating content queries across multiple sources.
 * Handles canonical key translation, result merging, and capability filtering.
 */
export class ContentQueryService {
  #registry;
  #mediaProgressMemory;

  /**
   * @param {Object} deps
   * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} deps.registry
   * @param {import('#apps/content/ports/IMediaProgressMemory.mjs').IMediaProgressMemory} [deps.mediaProgressMemory]
   */
  constructor({ registry, mediaProgressMemory = null }) {
    this.#registry = registry;
    this.#mediaProgressMemory = mediaProgressMemory;
  }

  /**
   * Search across multiple content sources.
   * Supports direct ID lookup (explicit "plex:123" or implicit "123") with text search fallback.
   * ID lookup and text search run in parallel for speed.
   *
   * @param {Object} query - Normalized query object
   * @returns {Promise<{items: Array, total: number, sources: string[], warnings?: Array}>}
   */
  async search(query) {
    const adapters = this.#registry.resolveSource(query.source);
    const warnings = [];

    // Check if query.text looks like a direct ID
    const idMatch = this.#parseIdFromText(query.text);

    // Run ID lookup and text search in parallel
    const [idResult, searchResults] = await Promise.all([
      // Direct ID lookup (if text looks like an ID)
      idMatch ? this.#lookupById(idMatch.source, idMatch.id, warnings) : Promise.resolve(null),

      // Standard text search across adapters
      Promise.all(
        adapters.map(async (adapter) => {
          try {
            if (!this.#canHandle(adapter, query)) return null;

            const translated = this.#translateQuery(adapter, query);
            const result = await adapter.search(translated);
            return { adapter, result };
          } catch (error) {
            warnings.push({
              source: adapter.source,
              error: error.message,
            });
            return null;
          }
        })
      )
    ]);

    // Filter out null results from search
    const results = searchResults.filter(Boolean);

    // Merge results with ID match leading
    return this.#mergeResultsWithIdMatch(idResult, results, query, warnings);
  }

  /**
   * Parse text to detect if it's a direct ID reference.
   *
   * NOTE: This method contains source-specific ID format knowledge as a
   * pragmatic tradeoff. Moving this to adapters would require significant
   * interface changes for minimal benefit. The ID formats (numeric for Plex,
   * UUID for Immich) are stable and unlikely to conflict with search terms.
   *
   * If this becomes problematic, adapters could implement:
   *   getIdPattern(): { pattern: RegExp, priority: number }
   *
   * Supports:
   * - Explicit "source:id" format (e.g., "plex:456724", "immich:abc-123")
   * - Implicit all-digits → plex (e.g., "456724")
   * - Implicit UUID → immich (e.g., "ff940f1a-f5ea-4580-a517-dfc68413e215")
   *
   * @param {string} text - Search text to check
   * @returns {{source: string, id: string} | null}
   */
  #parseIdFromText(text) {
    if (!text || typeof text !== 'string') return null;

    const trimmed = text.trim();

    // Explicit source:id format (e.g., "plex:456724", "immich:abc-123", "immich:person:abc-123")
    const explicitMatch = trimmed.match(/^([a-z]+):(.+)$/i);
    if (explicitMatch) {
      return { source: explicitMatch[1].toLowerCase(), id: explicitMatch[2] };
    }

    // Implicit all-digits → plex (e.g., "456724")
    if (/^\d+$/.test(trimmed)) {
      return { source: 'plex', id: trimmed };
    }

    // Implicit UUID → immich (e.g., "ff940f1a-f5ea-4580-a517-dfc68413e215")
    // UUID format: 8-4-4-4-12 hex characters
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      return { source: 'immich', id: trimmed };
    }

    return null;
  }

  /**
   * Attempt direct ID lookup from a source.
   *
   * @param {string} source - Source name
   * @param {string} id - Local ID
   * @param {Array} warnings - Warnings array to append errors
   * @returns {Promise<Object | null>} Item if found, null otherwise
   */
  async #lookupById(source, id, warnings) {
    try {
      const adapter = this.#registry.get(source);
      if (!adapter) {
        // Try resolving by source name in case it's a provider name
        const adapters = this.#registry.resolveSource(source);
        if (adapters.length === 0) return null;
        // Use first matching adapter
        return this.#lookupById(adapters[0].source, id, warnings);
      }

      // Try getItem if available
      if (typeof adapter.getItem === 'function') {
        const item = await adapter.getItem(id);
        if (item) {
          return { ...item, _idMatch: true };
        }
      }

      // Fallback: try to get item info via other means
      if (typeof adapter.getMetadata === 'function') {
        const metadata = await adapter.getMetadata(id);
        if (metadata) {
          return {
            id: `${source}:${id}`,
            source,
            localId: id,
            title: metadata.title,
            thumbnail: metadata.thumbnail,
            metadata,
            _idMatch: true
          };
        }
      }

      return null;
    } catch (error) {
      // Silent failure - ID lookup is best-effort
      warnings.push({
        source,
        error: `ID lookup failed: ${error.message}`,
      });
      return null;
    }
  }

  /**
   * Merge search results with ID match leading, sorted by relevance.
   */
  #mergeResultsWithIdMatch(idResult, results, query, warnings) {
    let items = results.flatMap(r => r.result.items || []);

    // If we have an ID match, prepend it (avoiding duplicates)
    if (idResult) {
      const idMatchId = idResult.id;
      // Remove any duplicate from search results
      items = items.filter(item => item.id !== idMatchId);
      // Prepend the ID match
      items.unshift(idResult);
    }

    // Apply capability filter
    if (query.capability) {
      items = items.filter(item => this.#hasCapability(item, query.capability));
    }

    // Apply relevance-based sorting (unless random or explicit sort)
    if (query.sort === 'random') {
      const idMatch = items.find(i => i._idMatch);
      const rest = items.filter(i => !i._idMatch);
      items = idMatch ? [idMatch, ...this.#shuffle(rest)] : this.#shuffle(items);
    } else if (!query.sort || query.sort === 'relevance') {
      // Sort by relevance - containers first, then artists, then tracks
      items = this.#sortByRelevance(items, query.text);
    }

    // Clean up internal flag
    items = items.map(({ _idMatch, ...item }) => item);

    // Apply pagination
    const skip = query.skip || 0;
    const take = query.take || items.length;
    const total = items.length;
    items = items.slice(skip, skip + take);

    const sources = [...new Set(items.map(i => i.source))];

    const result = { items, total, sources };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  }

  /**
   * Sort items by relevance score.
   * Delegates to domain RelevanceScoringService.
   * @param {Array} items
   * @param {string} [searchText]
   * @returns {Array}
   */
  #sortByRelevance(items, searchText) {
    return RelevanceScoringService.sortByRelevance(items, searchText);
  }

  /**
   * List containers from an alias (e.g., "playlists") across sources.
   *
   * @param {Object} query - Query with 'from' alias
   * @returns {Promise<{items: Array, total: number, sources: string[], picked?: Object}>}
   */
  async list(query) {
    const { from, source, pick } = query;
    const adapters = this.#registry.resolveSource(source);
    const results = [];
    const warnings = [];

    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const aliases = adapter.getContainerAliases?.() ?? {};
          const containerPath = aliases[from];

          if (!containerPath) return;

          // Pass full query with adapter-specific params, overriding alias with resolved path
          const listQuery = { ...query, from: containerPath };
          const items = await adapter.getList(listQuery);
          results.push({ adapter, result: { items, total: items.length } });
        } catch (error) {
          warnings.push({
            source: adapter.source,
            error: error.message,
          });
        }
      })
    );

    const merged = this.#mergeResults(results, query, warnings);

    // Handle pick=random
    if (pick === 'random' && merged.items.length > 0) {
      return this.#pickRandom(merged, query);
    }

    return merged;
  }

  /**
   * Pick a random container and return its contents.
   *
   * @param {Object} listResult - Result from list()
   * @param {Object} query - Original query for filtering contents
   * @returns {Promise<Object>}
   */
  async #pickRandom(listResult, query) {
    const containers = listResult.items.filter(i => i.itemType === 'container');
    if (containers.length === 0) {
      return { ...listResult, picked: null };
    }

    const picked = containers[Math.floor(Math.random() * containers.length)];
    const [source] = picked.id.split(':');
    const adapter = this.#registry.get(source);

    if (!adapter) {
      return { ...listResult, picked, items: [], total: 0 };
    }

    // Get contents of picked container
    const localId = picked.id.replace(`${source}:`, '');
    const contents = await adapter.getList(localId);

    // Apply filters to contents
    let filteredContents = contents;
    if (query.mediaType) {
      filteredContents = contents.filter(
        item => item.metadata?.type === query.mediaType || item.mediaType === query.mediaType
      );
    }

    return {
      from: query.from,
      picked: {
        id: picked.id,
        source: picked.source,
        title: picked.title,
      },
      sources: [picked.source],
      total: filteredContents.length,
      items: filteredContents,
    };
  }

  /**
   * Check if adapter can handle the query.
   */
  #canHandle(adapter, query) {
    const caps = adapter.getSearchCapabilities?.() ?? { canonical: [], specific: [] };
    const queryKeys = Object.keys(query).filter(k => !['source', 'take', 'skip', 'sort'].includes(k));

    // Must support at least one query key (or query is empty = list all)
    if (queryKeys.length === 0) return true;

    return queryKeys.some(k =>
      caps.canonical?.includes(k) || caps.specific?.includes(k)
    );
  }

  /**
   * Translate canonical query keys to adapter-specific.
   */
  #translateQuery(adapter, query) {
    const mappings = adapter.getQueryMappings?.() ?? {};
    const translated = {};

    for (const [key, value] of Object.entries(query)) {
      // Skip meta keys
      if (['source', 'capability'].includes(key)) continue;

      const mapping = mappings[key];
      if (mapping) {
        if (typeof mapping === 'string') {
          translated[mapping] = value;
        } else if (mapping.from && mapping.to && typeof value === 'object' && value.from !== undefined) {
          // Range mapping
          if (value.from) translated[mapping.from] = value.from;
          if (value.to) translated[mapping.to] = value.to;
        } else if (typeof mapping === 'object' && mapping.from) {
          // Range value as string "a..b"
          if (typeof value === 'string' && value.includes('..')) {
            const [from, to] = value.split('..');
            if (from) translated[mapping.from] = from;
            if (to) translated[mapping.to] = to;
          } else {
            translated[mapping.from] = value;
          }
        }
      } else {
        // Pass through unmapped keys
        translated[key] = value;
      }
    }

    return translated;
  }

  /**
   * Merge results from multiple adapters.
   */
  #mergeResults(results, query, warnings = []) {
    let items = results.flatMap(r => r.result.items || []);

    // Apply capability filter
    if (query.capability) {
      items = items.filter(item => this.#hasCapability(item, query.capability));
    }

    // Apply sort
    if (query.sort === 'random') {
      items = this.#shuffle(items);
    }

    // Apply pagination
    const skip = query.skip || 0;
    const take = query.take || items.length;
    const total = items.length;
    items = items.slice(skip, skip + take);

    const sources = [...new Set(items.map(i => i.source))];

    const result = { items, total, sources };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  }

  /**
   * Check if item has a capability.
   */
  #hasCapability(item, capability) {
    const capMap = {
      playable: () => typeof item.isPlayable === 'function' ? item.isPlayable() : !!item.mediaUrl,
      viewable: () => typeof item.isViewable === 'function' ? item.isViewable() : !!item.imageUrl,
      readable: () => typeof item.isReadable === 'function' ? item.isReadable() : !!item.contentUrl,
      listable: () => typeof item.isContainer === 'function' ? item.isContainer() : item.itemType === 'container',
    };
    return capMap[capability]?.() ?? false;
  }

  /**
   * Fisher-Yates shuffle.
   */
  #shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Enrich items with watch state from mediaProgressMemory.
   * @param {Array} items - Items to enrich
   * @param {Object} adapter - Adapter for storage path resolution
   * @returns {Promise<Array>} Enriched items
   */
  async #enrichWithWatchState(items, adapter) {
    if (!this.#mediaProgressMemory || items.length === 0) {
      return items;
    }

    return Promise.all(items.map(async (item) => {
      const storagePath = typeof adapter.getStoragePath === 'function'
        ? await adapter.getStoragePath(item.id)
        : adapter.source || 'default';

      const progress = await this.#mediaProgressMemory.get(item.id, storagePath);

      if (!progress) return item;

      const percent = progress.percent ?? 0;
      const isInProgress = percent > 0 && percent < 90;

      return {
        ...item,
        percent,
        playhead: progress.playhead ?? 0,
        duration: progress.duration ?? item.duration ?? 0,
        watched: percent >= 90,
        // Set priority to in_progress if partially watched (unless already set)
        priority: isInProgress && !item.priority ? 'in_progress' : item.priority
      };
    }));
  }

  /**
   * Resolve a query to playable items with selection applied.
   * @param {string} source - Source name
   * @param {string} localId - Local ID/path within source
   * @param {Object} [context] - Selection context
   * @param {Date} [context.now] - Current date
   * @param {string} [context.containerType] - Container type hint
   * @param {Object} [overrides] - Selection strategy overrides
   * @returns {Promise<{items: Array, strategy: Object}>}
   */
  async resolve(source, localId, context = {}, overrides = {}) {
    const adapter = this.#registry.get(source);
    if (!adapter) {
      throw new Error(`Unknown source: ${source}`);
    }

    if (typeof adapter.resolvePlayables !== 'function') {
      throw new Error(`Adapter ${source} does not support resolvePlayables`);
    }

    const items = await adapter.resolvePlayables(localId);
    const enriched = await this.#enrichWithWatchState(items, adapter);

    // Determine container type from adapter if not provided
    const containerType = context.containerType
      || (typeof adapter.getContainerType === 'function'
          ? adapter.getContainerType(localId)
          : 'watchlist');

    const selectionContext = {
      ...context,
      containerType,
      now: context.now || new Date()
    };

    const strategy = ItemSelectionService.resolveStrategy(selectionContext, overrides);
    const selected = ItemSelectionService.select(enriched, selectionContext, overrides);

    return {
      items: selected,
      strategy: {
        name: strategy.name,
        filter: strategy.filter,
        sort: strategy.sort,
        pick: strategy.pick
      }
    };
  }
}

export default ContentQueryService;
