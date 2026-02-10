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

  /**
   * @param {Object} deps
   * @param {import('#apps/content/SavedQueryService.mjs').SavedQueryService} deps.savedQueryService
   * @param {Object} [deps.fileAdapter] - FileAdapter for freshvideo queries
   * @param {Object} [deps.mediaProgressMemory] - Progress memory for watch state
   */
  constructor({ savedQueryService, fileAdapter, mediaProgressMemory } = {}) {
    this.#savedQueryService = savedQueryService;
    this.#fileAdapter = fileAdapter || null;
    this.#mediaProgressMemory = mediaProgressMemory || null;
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

    return {
      id: `query:${name}`,
      title: query.title,
      source: 'query',
      itemType: 'container',
      metadata: {
        queryType: query.source,
        sources: query.filters?.sources || [],
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
