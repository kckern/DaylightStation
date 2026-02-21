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
   * Queries don't have siblings.
   * @returns {Promise<{parent: null, items: Array}>}
   */
  async resolveSiblings() {
    return { parent: null, items: [] };
  }

  /**
   * Search is not supported for queries.
   * @returns {Promise<Array>}
   */
  async search() {
    return [];
  }

  getCapabilities() {
    return ['playable'];
  }
}
