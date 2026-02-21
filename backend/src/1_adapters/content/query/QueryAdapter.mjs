// backend/src/1_adapters/content/query/QueryAdapter.mjs

import path from 'path';
import { fileExists } from '#system/utils/FileIO.mjs';
import { ItemSelectionService } from '#domains/content/index.mjs';

/** Percentage threshold above which a video is considered "watched". */
const WATCHED_THRESHOLD = 90;

/**
 * Content adapter for saved queries (query:dailynews, etc.).
 *
 * Reads query definitions via SavedQueryService and executes them
 * by delegating to the appropriate content adapter (e.g., files adapter
 * for freshvideo queries).
 *
 * Implements IContentSource interface.
 */
export class QueryAdapter {
  #savedQueryService;
  #fileAdapter;
  #mediaProgressMemory;
  #registry;

  /**
   * @param {Object} deps
   * @param {import('#apps/content/SavedQueryService.mjs').SavedQueryService} deps.savedQueryService
   * @param {Object} [deps.fileAdapter] - FileAdapter for freshvideo queries
   * @param {Object} [deps.mediaProgressMemory] - Progress memory for watch state
   * @param {Object} [deps.registry] - ContentSourceRegistry for adapter lookup
   */
  constructor({ savedQueryService, fileAdapter, mediaProgressMemory, registry } = {}) {
    this.#savedQueryService = savedQueryService;
    this.#fileAdapter = fileAdapter || null;
    this.#mediaProgressMemory = mediaProgressMemory || null;
    this.#registry = registry || null;
  }

  get source() { return 'query'; }
  get prefixes() { return [{ prefix: 'query' }]; }

  /**
   * Strip query: prefix from an id.
   * @param {string} id
   * @returns {string}
   */
  #stripPrefix(id) {
    return id.replace(/^query:/, '');
  }

  /**
   * Get a query definition as a content item.
   * @param {string} id - e.g. "query:dailynews" or "dailynews"
   * @returns {Promise<Object|null>}
   */
  async getItem(id) {
    const name = this.#stripPrefix(id);
    const query = this.#savedQueryService.getQuery(name);
    if (!query) return null;

    // Resolve first playable to use its thumbnail for the query
    const playables = await this.resolvePlayables(id);
    const thumbnail = playables[0]?.thumbnail || null;

    // Format query type for display (e.g., "immich" → "Immich", "freshvideo" → "Freshvideo")
    const queryTypeLabel = query.source
      ? query.source.charAt(0).toUpperCase() + query.source.slice(1)
      : 'Query';

    return {
      id: `query:${name}`,
      title: query.title,
      source: 'query',
      itemType: 'container',
      thumbnail,
      metadata: {
        type: 'query',
        queryType: query.source,
        sources: query.filters?.sources || [],
        librarySectionTitle: queryTypeLabel,
        childCount: playables.length,
      },
    };
  }

  /**
   * Get query container (same as getItem for queries).
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getList(id) {
    return this.getItem(id);
  }

  /**
   * Resolve a saved query to playable items.
   * Dispatches by query type (currently: freshvideo).
   * @param {string} id - e.g. "query:dailynews"
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id) {
    const name = this.#stripPrefix(id);
    const query = this.#savedQueryService.getQuery(name);
    if (!query) return [];

    if (query.source === 'freshvideo') {
      return this.#resolveFreshVideo(query);
    }

    if (query.source === 'immich') {
      return this.#resolveImmichQuery(query);
    }

    console.warn(`[QueryAdapter] Unknown query type: ${query.source}`);
    return [];
  }

  /**
   * Resolve a freshvideo query to a single playable item.
   * Lists videos from each source, adds sourcePriority and date,
   * enriches with watch state, then applies freshvideo strategy.
   * @param {Object} query - Normalized query definition
   * @returns {Promise<Array>}
   */
  async #resolveFreshVideo(query) {
    const sources = query.filters?.sources || [];
    if (sources.length === 0) return [];

    if (!this.#fileAdapter) {
      console.warn('[QueryAdapter] FileAdapter not available for freshvideo query');
      return [];
    }

    const allItems = [];

    for (let i = 0; i < sources.length; i++) {
      const sourcePath = sources[i];
      const videoPath = `video/${sourcePath}`;

      try {
        const items = await this.#fileAdapter.getList(videoPath);

        for (const item of items) {
          if (item.itemType === 'container') continue;

          // Extract date from filename (YYYYMMDD.mp4 -> YYYYMMDD)
          const filename = item.localId?.split('/').pop() || '';
          const dateMatch = filename.match(/^(\d{8})/);
          const date = dateMatch ? dateMatch[1] : '00000000';

          const fullItem = await this.#fileAdapter.getItem(item.localId);
          if (!fullItem) continue;

          allItems.push({
            ...fullItem,
            date,
            sourcePriority: i,
            metadata: {
              ...fullItem.metadata,
              querySource: sourcePath,
              date,
            },
          });
        }
      } catch (err) {
        console.warn(`[QueryAdapter] Failed to list freshvideo source ${sourcePath}:`, err.message);
      }
    }

    if (allItems.length === 0) return [];

    // Enrich with watch state
    let enrichedItems = allItems;
    if (this.#mediaProgressMemory) {
      enrichedItems = await Promise.all(allItems.map(async (item) => {
        const mediaKey = item.localId || item.id?.replace(/^(files|media):/, '');
        const state = await this.#mediaProgressMemory.get(mediaKey, 'files');
        const percent = state?.percent || 0;
        return {
          ...item,
          percent,
          watched: percent >= WATCHED_THRESHOLD,
        };
      }));
    }

    // Apply freshvideo strategy
    const context = {
      containerType: 'freshvideo',
      now: new Date(),
    };

    const selected = ItemSelectionService.select(enrichedItems, context);

    // Use parent folder's show.jpg as thumbnail (channel branding > video frame)
    for (const item of selected) {
      const querySource = item.metadata?.querySource;
      if (!querySource || !this.#fileAdapter) continue;
      const folderPath = path.join(this.#fileAdapter.mediaBasePath, 'video', querySource);
      if (fileExists(path.join(folderPath, 'show.jpg'))) {
        item.thumbnail = `/api/v1/proxy/media/stream/${encodeURIComponent(`video/${querySource}/show.jpg`)}`;
      }
    }

    return selected;
  }

  /**
   * Resolve an immich query by searching across date ranges.
   * Loops from yearFrom to current year, searching each year for the given month/day.
   * @param {Object} query - Normalized query definition with params
   * @returns {Promise<Array>}
   */
  async #resolveImmichQuery(query) {
    if (!this.#registry) {
      console.warn('[QueryAdapter] Registry not available for immich query');
      return [];
    }

    const adapter = this.#registry.get('immich');
    if (!adapter) {
      console.warn('[QueryAdapter] ImmichAdapter not registered');
      return [];
    }

    const { mediaType, month, day, yearFrom } = query.params;
    if (!month || !day || !yearFrom) {
      console.warn('[QueryAdapter] Immich query missing required params (month, day, yearFrom)');
      return [];
    }

    const currentYear = new Date().getFullYear();
    const paddedMonth = String(month).padStart(2, '0');
    const paddedDay = String(day).padStart(2, '0');
    const targetDate = `${paddedMonth}-${paddedDay}`;

    // Search each year with a ±1 day UTC window to cover all timezones,
    // then post-filter by the asset's local date (from filename)
    const yearPromises = [];
    for (let year = yearFrom; year <= currentYear; year++) {
      const dayBefore = new Date(Date.UTC(year, month - 1, day - 1));
      const dayAfter = new Date(Date.UTC(year, month - 1, day + 1, 23, 59, 59, 999));
      yearPromises.push(
        adapter.search({
          mediaType: mediaType || undefined,
          dateFrom: dayBefore.toISOString(),
          dateTo: dayAfter.toISOString(),
        }).catch(err => {
          console.warn(`[QueryAdapter] Immich search failed for ${year}:`, err.message);
          return { items: [] };
        })
      );
    }

    const results = await Promise.all(yearPromises);
    const allItems = results.flatMap(r => r.items || []);

    // Dedupe by ID
    const seen = new Set();
    const deduped = allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Post-filter by local date extracted from filename (YYYY-MM-DD format)
    // Filenames reflect the local capture time, not UTC
    const dateFiltered = deduped.filter(item => {
      const match = (item.title || '').match(/(\d{4})-(\d{2})-(\d{2})/);
      return match && `${match[2]}-${match[3]}` === targetDate;
    });

    // Filter by mediaType if specified
    let filtered = mediaType
      ? dateFiltered.filter(item => item.mediaType === mediaType)
      : dateFiltered;

    // Sort if specified
    if (query.sort) {
      const getDate = (item) => item.metadata?.capturedAt || item.title || '';
      if (query.sort === 'date_desc') {
        filtered.sort((a, b) => getDate(b).localeCompare(getDate(a)));
      } else if (query.sort === 'date_asc') {
        filtered.sort((a, b) => getDate(a).localeCompare(getDate(b)));
      }
    }

    return filtered;
  }

  /**
   * Build a human-readable description from a query definition.
   * @param {Object} query - Normalized query from SavedQueryService
   * @param {string} name - Query filename
   * @returns {string}
   */
  #describeQuery(query, name) {
    if (!query) return name;
    const parts = [];
    const src = query.source || 'query';
    parts.push(src.charAt(0).toUpperCase() + src.slice(1));

    if (src === 'freshvideo' && query.filters?.sources?.length) {
      parts.push(`· ${query.filters.sources.join(', ')}`);
    } else if (src === 'immich' && query.params) {
      const { month, day, yearFrom } = query.params;
      if (month && day) parts.push(`· ${month}/${day}`);
      if (yearFrom) parts.push(`since ${yearFrom}`);
    } else if (query.filters?.sources?.length) {
      parts.push(`· ${query.filters.sources.join(', ')}`);
    }
    if (query.take) parts.push(`(limit ${query.take})`);
    return parts.join(' ');
  }

  /**
   * Return all saved queries as siblings, grouped by origin (household vs user).
   * @param {string} compoundId
   * @returns {Promise<{parent: Object, items: Array}>}
   */
  async resolveSiblings(compoundId) {
    const detailed = this.#savedQueryService.listQueriesDetailed();

    // Build base items from YAML definitions (cheap)
    const baseItems = detailed.map(({ name, origin, username }) => {
      const query = this.#savedQueryService.getQuery(name);
      const queryType = query?.source || 'query';
      const group = origin === 'user' ? `${username}'s Queries` : 'Shared Queries';
      const description = this.#describeQuery(query, name);
      const queryTypeLabel = queryType.charAt(0).toUpperCase() + queryType.slice(1);

      return {
        name,
        query,
        item: {
          id: `query:${name}`,
          title: query?.title || name,
          source: 'query',
          type: queryType,
          thumbnail: null,
          group,
          metadata: {
            type: queryType,
            queryType: query?.source,
            parentTitle: description,
            librarySectionTitle: queryTypeLabel,
            childCount: null,
            origin,
            username: username || null,
          },
        },
      };
    });

    // Resolve thumbnails and childCounts in parallel (best effort)
    await Promise.all(baseItems.map(async ({ name, query, item }) => {
      try {
        // Try resolvePlayables first (handles freshvideo, immich)
        const playables = await this.resolvePlayables(`query:${name}`);
        if (playables.length > 0) {
          item.thumbnail = playables[0].thumbnail || null;
          item.metadata.childCount = playables.length;
          return;
        }

        // Fallback: ask the target adapter via registry for a thumbnail
        if (!this.#registry || !query?.source) return;

        // Try registry lookup with common name variations
        const sourceType = query.source;
        const adapter = this.#registry.get(sourceType)
          || this.#registry.get(sourceType.split('-')[0]);  // abs-ebooks → abs
        if (!adapter) return;

        // If query has parentIds, try each until we get a thumbnail
        const parentIds = query.params?.parentIds;
        if (parentIds?.length && adapter.getItem) {
          for (const entry of parentIds) {
            const pid = String(entry.id || entry);
            const parentItem = await adapter.getItem(pid).catch(() => null);
            if (parentItem?.thumbnail) {
              item.thumbnail = parentItem.thumbnail;
              return;
            }
          }
        }

        // If adapter supports search, try with query name then empty
        if (adapter.search) {
          const results = await adapter.search({ text: name, take: 1 }).catch(() => null);
          const first = results?.items?.[0];
          if (first?.thumbnail) {
            item.thumbnail = first.thumbnail;
            return;
          }
        }

        // Last resort: try listing root to grab any thumbnail
        if (adapter.getList) {
          const listItems = await adapter.getList('').catch(() => []);
          const withThumb = (Array.isArray(listItems) ? listItems : []).find(i => i.thumbnail);
          if (withThumb?.thumbnail) {
            item.thumbnail = withThumb.thumbnail;
          }
        }
      } catch {
        // Best effort — leave thumbnail/childCount as null
      }
    }));

    const items = baseItems.map(b => b.item);

    const parent = {
      id: 'query:*',
      title: 'Saved Queries',
      source: 'query',
      thumbnail: null,
      parentId: null,
      libraryId: null,
    };

    return { parent, items };
  }

  getSearchCapabilities() {
    return { canonical: ['text'], specific: [] };
  }

  /**
   * Search saved queries by name and title.
   * @param {Object} query
   * @param {string} [query.text] - Search text to match against name/title
   * @param {number} [query.take=50] - Max results
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    const { text, take = 50 } = query;
    const searchText = (text || '').toLowerCase();
    const allNames = this.#savedQueryService.listQueries();
    const items = [];

    for (const name of allNames) {
      const def = this.#savedQueryService.getQuery(name);
      if (!def) continue;

      const nameMatch = name.toLowerCase().includes(searchText);
      const titleMatch = def.title?.toLowerCase().includes(searchText);

      if (nameMatch || titleMatch || !searchText) {
        items.push({
          id: `query:${name}`,
          title: def.title || name,
          source: 'query',
          type: def.source || 'query',
          metadata: {
            type: def.source || 'query',
            queryType: def.source,
          },
        });
        if (items.length >= take) break;
      }
    }

    return { items, total: items.length };
  }

  getCapabilities() {
    return ['playable'];
  }
}
