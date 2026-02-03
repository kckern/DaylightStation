// backend/src/1_adapters/content/list/ListAdapter.mjs
import path from 'path';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { Item } from '#domains/content/entities/Item.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
import { ItemSelectionService } from '#domains/content/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  dirExists,
  listEntries,
  fileExists,
  loadYaml
} from '#system/utils/FileIO.mjs';

/**
 * Day normalization for schedule filtering.
 * Accepts both string presets and array format.
 */
const DAY_PRESETS = {
  daily: ['M', 'T', 'W', 'Th', 'F', 'Saturday', 'Sunday'],
  weekdays: ['M', 'T', 'W', 'Th', 'F'],
  weekend: ['Saturday', 'Sunday'],
  mwf: ['M', 'W', 'F'],
  tth: ['T', 'Th']
};

// Map JavaScript day index (0=Sunday) to day abbreviation
const JS_DAY_TO_ABBREV = ['Sunday', 'M', 'T', 'W', 'Th', 'F', 'Saturday'];

/**
 * Format a kebab-case or camelCase name to human-readable title
 * @param {string} name - Raw name like "comefollowme2025" or "morning-program"
 * @returns {string} Formatted title
 */
function formatListTitle(name) {
  if (!name) return 'Untitled';

  // Known patterns to expand (add more as needed)
  const expansions = {
    'comefollowme': 'Come Follow Me',
    'cfm': 'Come Follow Me',
    'dailynews': 'Daily News',
    'morningprogram': 'Morning Program',
    'kidsqueue': 'Kids Queue'
  };

  // Check for known patterns first (case-insensitive)
  const lowerName = name.toLowerCase();
  for (const [pattern, expansion] of Object.entries(expansions)) {
    if (lowerName.startsWith(pattern)) {
      const suffix = name.slice(pattern.length);
      // Format suffix (usually a year like "2025")
      const formattedSuffix = suffix ? ` ${suffix}` : '';
      return expansion + formattedSuffix;
    }
  }

  // Split on hyphens or camelCase boundaries
  let formatted = name
    .replace(/-/g, ' ')  // Replace hyphens with spaces
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // Insert space before capitals
    .replace(/(\d+)/g, ' $1')  // Insert space before numbers
    .trim();

  // Capitalize first letter of each word
  formatted = formatted.replace(/\b\w/g, c => c.toUpperCase());

  return formatted;
}

/**
 * ListAdapter - Exposes menus, programs, and watchlists as content sources.
 *
 * Prefixes and paths:
 * | Prefix      | Path                                           |
 * |-------------|------------------------------------------------|
 * | menu:       | data/household/config/lists/menus/{name}.yml   |
 * | program:    | data/household/config/lists/programs/{name}.yml|
 * | watchlist:  | data/household/config/lists/watchlists/{name}.yml|
 *
 * ID format: {prefix}:{name}
 * Examples: menu:fhe, program:music-queue, watchlist:kids-movies
 */
export class ListAdapter {
  /**
   * @param {Object} config
   * @param {string} config.dataPath - Base data path
   * @param {string} [config.householdId] - Household ID
   * @param {Object} [config.registry] - ContentSourceRegistry for resolving list items
   * @param {Object} [config.mediaProgressMemory] - MediaProgressMemory for watch state
   * @param {Object} [config.configService] - ConfigService for reading household config
   */
  constructor(config) {
    if (!config.dataPath) {
      throw new InfrastructureError('ListAdapter requires dataPath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataPath'
      });
    }

    this.dataPath = config.dataPath;
    this.householdId = config.householdId;
    this.registry = config.registry || null;
    this.mediaProgressMemory = config.mediaProgressMemory || null;
    this.configService = config.configService || null;

    // Cache for loaded lists
    this._listCache = new Map();
  }

  get source() {
    return 'list';
  }

  get prefixes() {
    return [
      { prefix: 'menu', idTransform: (id) => `menu:${id}` },
      { prefix: 'program', idTransform: (id) => `program:${id}` },
      { prefix: 'watchlist', idTransform: (id) => `watchlist:${id}` },
      { prefix: 'query', idTransform: (id) => `query:${id}` }
    ];
  }

  /**
   * Get the list type from a prefix
   * @param {string} prefix
   * @returns {'menus'|'programs'|'watchlists'|'queries'|null}
   */
  _getListType(prefix) {
    const map = {
      menu: 'menus',
      program: 'programs',
      watchlist: 'watchlists',
      query: 'queries'
    };
    return map[prefix] || null;
  }

  /**
   * Parse a compound ID into prefix and name
   * @param {string} id - e.g., "menu:fhe" or "program:music-queue" or "query:dailynews"
   * @returns {{prefix: string, name: string}|null}
   */
  _parseId(id) {
    const match = id.match(/^(menu|program|watchlist|query):(.+)$/);
    if (!match) return null;
    return { prefix: match[1], name: match[2] };
  }

  /**
   * Get the file path for a list
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @param {string} name - List name
   * @returns {string}
   */
  _getListPath(listType, name) {
    // Check household-specific path first
    const householdPath = path.join(
      this.dataPath,
      `household${this.householdId ? `-${this.householdId}` : ''}`,
      'config',
      'lists',
      listType,
      `${name}.yml`
    );

    if (fileExists(householdPath)) {
      return householdPath;
    }

    // Fall back to default household path
    return path.join(
      this.dataPath,
      'household',
      'config',
      'lists',
      listType,
      `${name}.yml`
    );
  }

  /**
   * Get the directory path for a list type
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @returns {string}
   */
  _getListDir(listType) {
    // Check household-specific path first
    const householdPath = path.join(
      this.dataPath,
      `household${this.householdId ? `-${this.householdId}` : ''}`,
      'config',
      'lists',
      listType
    );

    if (dirExists(householdPath)) {
      return householdPath;
    }

    // Fall back to default household path
    return path.join(
      this.dataPath,
      'household',
      'config',
      'lists',
      listType
    );
  }

  /**
   * Load a list from YAML file
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @param {string} name - List name
   * @returns {Object|null}
   */
  _loadList(listType, name) {
    const cacheKey = `${listType}:${name}`;
    if (this._listCache.has(cacheKey)) {
      return this._listCache.get(cacheKey);
    }

    const filePath = this._getListPath(listType, name);
    if (!fileExists(filePath)) {
      return null;
    }

    try {
      const data = loadYaml(filePath.replace(/\.yml$/, ''));
      this._listCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.warn(`Failed to load list ${listType}/${name}:`, err.message);
      return null;
    }
  }

  /**
   * Get all list names for a type
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @returns {string[]}
   */
  _getAllListNames(listType) {
    const dir = this._getListDir(listType);
    if (!dirExists(dir)) return [];

    return listEntries(dir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => f.replace(/\.(yml|yaml)$/, ''));
  }

  /**
   * Normalize days specification to array format
   * @param {string|string[]} days - Days specification (preset string or array)
   * @returns {string[]}
   */
  _normalizeDays(days) {
    if (!days) return [];

    // String preset
    if (typeof days === 'string') {
      const preset = days.toLowerCase();
      return DAY_PRESETS[preset] || [days];
    }

    // Already an array
    if (Array.isArray(days)) {
      return days;
    }

    return [];
  }

  /**
   * Check if an item matches today's schedule
   * @param {Object} item - List item with optional 'days' field
   * @returns {boolean}
   */
  _matchesToday(item) {
    if (!item.days) return true; // No schedule = always matches

    const normalizedDays = this._normalizeDays(item.days);
    if (normalizedDays.length === 0) return true;

    const today = JS_DAY_TO_ABBREV[new Date().getDay()];
    return normalizedDays.some(d => {
      const normalized = d.toLowerCase();
      return normalized === today.toLowerCase() ||
             (normalized === 'm' && today === 'M') ||
             (normalized === 't' && today === 'T') ||
             (normalized === 'w' && today === 'W') ||
             (normalized === 'th' && today === 'Th') ||
             (normalized === 'f' && today === 'F') ||
             (normalized === 'saturday' && today === 'Saturday') ||
             (normalized === 'sunday' && today === 'Sunday');
    });
  }

  /**
   * @param {string} id - Compound ID like "menu:fhe" or just the prefix "menu:"
   * @returns {Promise<Item|ListableItem|null>}
   */
  async getItem(id) {
    const parsed = this._parseId(id);
    if (!parsed) return null;

    const listType = this._getListType(parsed.prefix);
    if (!listType) return null;

    const listData = this._loadList(listType, parsed.name);
    if (!listData) return null;

    // Return list metadata
    const items = Array.isArray(listData) ? listData : (listData.items || []);

    // Get title: prefer explicit title, then format from name
    const title = listData.title || listData.label || formatListTitle(parsed.name);

    // Try to get thumbnail from first item in list (if available)
    let thumbnail = listData.image || null;
    if (!thumbnail && items.length > 0 && items[0].image) {
      thumbnail = items[0].image;
    }

    // Build parent/library label for UI display
    const typeLabels = {
      watchlist: 'Watchlists',
      program: 'Programs',
      menu: 'Menus',
      query: 'Queries'
    };
    const librarySectionTitle = listData.group || typeLabels[parsed.prefix] || 'Lists';

    return new ListableItem({
      id,
      source: 'list',
      localId: `${parsed.prefix}:${parsed.name}`,
      title,
      type: parsed.prefix,  // 'watchlist', 'query', 'program', 'menu'
      thumbnail,
      itemType: 'container',
      childCount: items.length,
      metadata: {
        category: ContentCategory.LIST,
        type: parsed.prefix,  // Also in metadata for frontend compatibility
        listType: parsed.prefix,
        description: listData.description,
        childCount: items.length,
        librarySectionTitle
      }
    });
  }

  /**
   * @param {string} id - Compound ID or just prefix for browsing all lists
   * @returns {Promise<ListableItem[]|ListableItem|null>}
   */
  async getList(id) {
    // Strip source prefix if present (e.g., "list:watchlist:" → "watchlist:")
    const strippedId = id.replace(/^list:/, '');

    // Handle "menu:", "program:", "watchlist:", "query:" - return all lists of that type
    const prefixMatch = strippedId.match(/^(menu|program|watchlist|query):$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const listType = this._getListType(prefix);
      const names = this._getAllListNames(listType);

      return names.map(name => {
        const listData = this._loadList(listType, name);
        const items = Array.isArray(listData) ? listData : (listData?.items || []);
        const title = listData?.title || listData?.label || formatListTitle(name);

        // Try to get thumbnail from list config or first item
        let thumbnail = listData?.image || null;
        if (!thumbnail && items.length > 0 && items[0].image) {
          thumbnail = items[0].image;
        }

        return new ListableItem({
          id: `${prefix}:${name}`,
          source: 'list',
          localId: `${prefix}:${name}`,
          title,
          type: prefix,
          thumbnail,
          itemType: 'container',
          childCount: items.length,
          metadata: {
            category: ContentCategory.LIST,
            type: prefix,
            listType: prefix
          }
        });
      });
    }

    // Handle specific list "menu:fhe" - return items within
    const parsed = this._parseId(strippedId);
    if (!parsed) return null;

    const listType = this._getListType(parsed.prefix);
    if (!listType) return null;

    const listData = this._loadList(listType, parsed.name);
    if (!listData) return null;

    const items = Array.isArray(listData) ? listData : (listData.items || []);
    const children = await this._buildListItems(items, parsed.prefix);
    const title = listData.title || listData.label || formatListTitle(parsed.name);

    // Try to get thumbnail from list config or first item
    let thumbnail = listData.image || null;
    if (!thumbnail && items.length > 0 && items[0].image) {
      thumbnail = items[0].image;
    }

    return new ListableItem({
      id,
      source: 'list',
      localId: `${parsed.prefix}:${parsed.name}`,
      title,
      type: parsed.prefix,
      thumbnail,
      itemType: 'container',
      children,
      metadata: {
        category: ContentCategory.LIST,
        type: parsed.prefix,
        listType: parsed.prefix
      }
    });
  }

  /**
   * Build Item objects from list items
   * @param {Array} items - Raw items from YAML
   * @param {string} listPrefix - 'menu', 'program', 'watchlist'
   * @returns {Promise<Item[]>}
   */
  async _buildListItems(items, listPrefix) {
    const results = [];

    for (const item of items) {
      if (item.active === false) continue;

      // Parse input field to determine source
      const input = item.input || '';
      let source = 'list';
      let localId = input;

      // Handle various input formats
      const inputMatch = input.match(/^(\w+):(.+)$/);
      if (inputMatch) {
        source = inputMatch[1];
        localId = inputMatch[2];
      }

      // Build action based on action field
      const actionType = (item.action || 'Play').toLowerCase();
      const actions = {};

      if (actionType === 'list') {
        actions.list = { [source]: localId };
      } else if (actionType === 'queue') {
        actions.queue = { [source]: localId };
        if (item.shuffle) actions.queue.shuffle = true;
        if (item.continuous) actions.queue.continuous = true;
      } else if (actionType === 'open') {
        actions.open = { [source]: localId };
      } else {
        // Default: play
        actions.play = { [source]: localId };
      }

      results.push(new Item({
        id: input || `${listPrefix}:${item.label}`,
        source,
        localId,
        title: item.label || localId,
        thumbnail: item.image,
        metadata: {
          category: ContentCategory.LIST,
          listType: listPrefix,
          days: item.days,
          applySchedule: item.applySchedule
        },
        actions
      }));
    }

    return results;
  }

  /**
   * @param {string} id
   * @param {Object} options
   * @param {boolean} [options.applySchedule=true] - Apply schedule filtering for programs
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id, options = {}) {
    const { applySchedule = true } = options;

    const parsed = this._parseId(id);
    if (!parsed) return [];

    // Handle query: prefix specially
    if (parsed.prefix === 'query') {
      return this._resolveQuery(parsed.name);
    }

    const listType = this._getListType(parsed.prefix);
    if (!listType) return [];

    const listData = this._loadList(listType, parsed.name);
    if (!listData) return [];

    const items = Array.isArray(listData) ? listData : (listData.items || []);
    const playables = [];

    for (const item of items) {
      if (item.active === false) continue;

      // Apply schedule filtering for programs (if not overridden)
      if (applySchedule && listType === 'programs') {
        // Check item-level applySchedule override
        const shouldApply = item.applySchedule !== false;
        if (shouldApply && !this._matchesToday(item)) {
          continue;
        }
      }

      const input = item.input || '';
      if (!input) continue;

      // Resolve through registry
      if (this.registry) {
        const resolved = this.registry.resolve(input);
        if (resolved?.adapter?.resolvePlayables) {
          const childPlayables = await resolved.adapter.resolvePlayables(input);
          playables.push(...childPlayables);
        }
      }
    }

    return playables;
  }

  /**
   * Resolve a query definition to playable items.
   * Supports query types: freshvideo
   * @param {string} queryName - Query name (e.g., "dailynews")
   * @returns {Promise<Array>}
   * @private
   */
  async _resolveQuery(queryName) {
    const queryData = this._loadList('queries', queryName);
    if (!queryData) return [];

    const queryType = queryData.type;

    if (queryType === 'freshvideo') {
      return this._resolveFreshVideoQuery(queryData);
    }

    // Unknown query type
    console.warn(`[ListAdapter] Unknown query type: ${queryType}`);
    return [];
  }

  /**
   * Resolve a freshvideo query to a single playable item.
   * Lists videos from each source, adds sourcePriority and date,
   * then applies freshvideo strategy (filter watched, sort by date desc + priority, pick first).
   * @param {Object} queryData - Query definition { type: 'freshvideo', sources: [...] }
   * @returns {Promise<Array>}
   * @private
   */
  async _resolveFreshVideoQuery(queryData) {
    const sources = queryData.sources || [];
    if (sources.length === 0) return [];

    const allItems = [];
    const filesystemAdapter = this.registry?.get('filesystem');

    if (!filesystemAdapter) {
      console.warn('[ListAdapter] FilesystemAdapter not available for freshvideo query');
      return [];
    }

    // Collect videos from each source with priority
    for (let i = 0; i < sources.length; i++) {
      const sourcePath = sources[i];
      const videoPath = `video/${sourcePath}`;

      try {
        // Get list of videos from the source directory
        const items = await filesystemAdapter.getList(videoPath);

        for (const item of items) {
          if (item.itemType !== 'leaf') continue;

          // Extract date from filename (YYYYMMDD.mp4 -> YYYYMMDD)
          const filename = item.localId?.split('/').pop() || '';
          const dateMatch = filename.match(/^(\d{8})/);
          const date = dateMatch ? dateMatch[1] : '00000000';

          // Get full item with media URL
          const fullItem = await filesystemAdapter.getItem(item.localId);
          if (!fullItem) continue;

          allItems.push({
            ...fullItem,
            date,
            sourcePriority: i,
            // Add metadata for display
            metadata: {
              ...fullItem.metadata,
              querySource: sourcePath,
              date
            }
          });
        }
      } catch (err) {
        console.warn(`[ListAdapter] Failed to list freshvideo source ${sourcePath}:`, err.message);
      }
    }

    if (allItems.length === 0) return [];

    // Enrich with watch state if available
    let enrichedItems = allItems;
    if (this.mediaProgressMemory) {
      enrichedItems = await Promise.all(allItems.map(async (item) => {
        const mediaKey = item.localId || item.id?.replace('filesystem:', '');
        const state = await this.mediaProgressMemory.get(mediaKey, 'media');
        const percent = state?.percent || 0;
        return {
          ...item,
          percent,
          watched: percent >= 90
        };
      }));
    }

    // Apply freshvideo strategy using ItemSelectionService
    const context = {
      containerType: 'freshvideo',
      now: new Date()
    };

    const selected = ItemSelectionService.select(enrichedItems, context);
    return selected;
  }

  /**
   * Search list names and item labels
   * @param {Object} query
   * @param {string} query.text - Search text
   * @returns {Promise<Array>}
   */
  async search({ text }) {
    if (!text || text.length < 2) return [];

    const searchLower = text.toLowerCase();
    const results = [];

    // Search all list types
    for (const prefix of ['menu', 'program', 'watchlist']) {
      const listType = this._getListType(prefix);
      const names = this._getAllListNames(listType);

      for (const name of names) {
        const listData = this._loadList(listType, name);
        if (!listData) continue;

        const title = listData.title || listData.label || name;

        // Check if list name matches
        if (name.toLowerCase().includes(searchLower) ||
            title.toLowerCase().includes(searchLower)) {
          results.push(await this.getItem(`${prefix}:${name}`));
        }

        // Check if any item labels match
        const items = Array.isArray(listData) ? listData : (listData.items || []);
        for (const item of items) {
          if (item.label?.toLowerCase().includes(searchLower)) {
            // Return the parent list as a result (contains matching item)
            const existing = results.find(r => r?.id === `${prefix}:${name}`);
            if (!existing) {
              results.push(await this.getItem(`${prefix}:${name}`));
            }
            break;
          }
        }
      }
    }

    return results.filter(Boolean);
  }

  /**
   * Clear cached data
   */
  clearCache() {
    this._listCache.clear();
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    const parsed = this._parseId(id);
    return parsed ? `list_${parsed.prefix}` : 'list';
  }
}

export default ListAdapter;
