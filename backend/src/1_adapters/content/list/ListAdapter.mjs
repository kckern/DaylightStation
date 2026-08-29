// backend/src/1_adapters/content/list/ListAdapter.mjs
import path from 'path';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { Item } from '#domains/content/entities/Item.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  dirExists,
  listEntries,
  fileExists,
  loadYaml,
  getStats
} from '#system/utils/FileIO.mjs';
import { normalizeListItem, extractContentId, normalizeListConfig } from './ListConfigCodec.mjs';
import { getCurrentDate } from '#system/utils/time.mjs';
import { QueueService } from '#domains/content/services/QueueService.mjs';
import { ItemSelectionService } from '#domains/content/services/ItemSelectionService.mjs';
import {
  normalizeListDays,
  listItemMatchesDay,
  watchlistPriority,
  shouldSkipListPlayback,
  cascadePriority,
  compareWatchlistItems,
} from '#domains/content/services/ListPlaybackPolicy.mjs';

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
 * | menu:       | data/content/lists/menus/{name}.yml            |
 * | program:    | data/content/lists/programs/{name}.yml         |
 * | watchlist:  | data/content/lists/watchlists/{name}.yml       |
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
   * @param {string[]} [config.nomusicLabels] - Array of Plex label strings for nomusic detection
   * @param {string} [config.musicOverlayPlaylist] - Plex ID for music overlay playlist
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

    // Overlay config for nomusic items (ported from FolderAdapter)
    this.nomusicLabels = config.nomusicLabels || [];
    this.musicOverlayPlaylist = config.musicOverlayPlaylist || null;
    this._nomusicCache = {};

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
      { prefix: 'watchlist', idTransform: (id) => `watchlist:${id}` }
    ];
  }

  /**
   * Derive capabilities for a list item.
   * Domain knowledge: lists (menus, programs, watchlists) are always queueable if listable.
   *
   * @param {Object} item - The item to analyze
   * @returns {string[]} Array of capability strings
   */
  getCapabilities(item) {
    const capabilities = [];

    // playable: has media URL
    if (item.mediaUrl) {
      capabilities.push('playable');
    }

    // displayable: has visual representation
    if (item.thumbnail || item.imageUrl) {
      capabilities.push('displayable');
    }

    // listable: is a container with children
    const isListable = item.items || item.itemType === 'container';
    if (isListable) {
      capabilities.push('listable');
    }

    // queueable: all list containers are queueable by design
    // Domain knowledge: menus, programs, and watchlists all resolve to playable items
    if (isListable) {
      capabilities.push('queueable');
    }

    return capabilities;
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
    };
    return map[prefix] || null;
  }

  /**
   * Parse a compound ID into prefix and name
   * @param {string} id - e.g., "menu:fhe" or "program:music-queue" or "query:dailynews"
   * @returns {{prefix: string, name: string}|null}
   */
  _parseId(id) {
    const match = id.match(/^(menu|program|watchlist|list):(.+)$/);
    if (!match) return null;
    const prefix = match[1] === 'list' ? 'menu' : match[1];
    return { prefix, name: match[2] };
  }

  /**
   * Get the file path for a list
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @param {string} name - List name
   * @returns {string}
   */
  _getListPath(listType, name) {
    // content/lists is a top-level tree, sibling to household/ — NOT
    // household-scoped, so there is a single lookup path (no per-household
    // fallback loop).
    const exact = path.join(this.dataPath, 'content', 'lists', listType, `${name}.yml`);
    if (fileExists(exact)) return exact;

    // Try case-insensitive match in the target directory
    const caseMatch = this._findFileInsensitive(listType, name);
    if (caseMatch) return caseMatch;

    // For watchlist: prefix, fall back to menus/ directory (backward compat with FolderAdapter)
    if (listType === 'watchlists') {
      const menuPath = path.join(this.dataPath, 'content', 'lists', 'menus', `${name}.yml`);
      if (fileExists(menuPath)) return menuPath;
      const menuCaseMatch = this._findFileInsensitive('menus', name);
      if (menuCaseMatch) return menuCaseMatch;
    }

    // Return default path (will fail gracefully in _loadList).
    return exact;
  }

  /**
   * Case-insensitive file lookup in a list type directory
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @param {string} name - List name to find
   * @returns {string|null} Full path if found, null otherwise
   * @private
   */
  _findFileInsensitive(listType, name) {
    const nameLower = name.toLowerCase();
    const dir = path.join(this.dataPath, 'content', 'lists', listType);
    if (!dirExists(dir)) return null;

    const entries = listEntries(dir);
    for (const entry of entries) {
      if (entry.toLowerCase() === `${nameLower}.yml` || entry.toLowerCase() === `${nameLower}.yaml`) {
        return path.join(dir, entry);
      }
    }
    return null;
  }

  /**
   * Get the directory path for a list type
   * @param {string} listType - 'menus', 'programs', 'watchlists'
   * @returns {string}
   */
  _getListDir(listType) {
    // content/lists is a top-level tree, sibling to household/ — NOT
    // household-scoped.
    return path.join(
      this.dataPath,
      'content',
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
    const filePath = this._getListPath(listType, name);
    if (!filePath || !fileExists(filePath)) {
      this._listCache.delete(cacheKey);
      return null;
    }

    const mtime = getStats(filePath)?.mtimeMs;
    const cached = this._listCache.get(cacheKey);
    if (cached && cached.mtime === mtime) {
      return cached.data;
    }

    try {
      const raw = loadYaml(filePath.replace(/\.yml$/, ''));
      const data = normalizeListConfig(raw, name);
      this._listCache.set(cacheKey, { data, mtime });
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
    return normalizeListDays(days);
  }

  /**
   * Check if an item matches today's schedule
   * @param {Object} item - List item with optional 'days' field
   * @returns {boolean}
   */
  _matchesToday(item) {
    return listItemMatchesDay(item, new Date().getDay());
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
    const items = listData.sections.flatMap(s => s.items);

    // Get title: prefer explicit title, then format from name
    const title = listData.title || formatListTitle(parsed.name);

    // Try to get thumbnail from first item in list (if available)
    let thumbnail = listData.image || null;
    if (!thumbnail && items.length > 0 && items[0].image) {
      thumbnail = items[0].image;
    }

    // Resolve thumbnail from first child's content source when no explicit image
    if (!thumbnail && items.length > 0 && this.registry) {
      const firstInput = extractContentId(items[0]);
      if (firstInput) {
        const resolved = this.registry.resolve(firstInput);
        if (resolved?.adapter?.getItem) {
          try {
            const canonicalId = `${resolved.adapter.source}:${resolved.localId}`;
            const childItem = await resolved.adapter.getItem(canonicalId);
            if (childItem?.thumbnail) thumbnail = childItem.thumbnail;
          } catch { /* thumbnail is decorative */ }
        }
      }
    }

    // Build parent/library label for UI display
    const typeLabels = {
      watchlist: 'Watchlists',
      program: 'Programs',
      menu: 'Menus',
      query: 'Queries'
    };
    const librarySectionTitle = listData.metadata?.group || typeLabels[parsed.prefix] || 'Lists';
    const canonicalId = `${parsed.prefix}:${parsed.name}`;

    return new ListableItem({
      id: canonicalId,
      source: 'list',
      localId: canonicalId,
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
   * Resolve the progress-tracking namespace for a watchlist by name.
   * Used by the play/log endpoint to determine storage path from a listId.
   * @param {string} listName - Watchlist file name (e.g., 'kidsscriptures2026')
   * @returns {Promise<string|null>} The namespace from list metadata, or null
   */
  async getListNamespace(listName) {
    const listData = this._loadList('watchlists', listName);
    return listData?.metadata?.namespace || null;
  }

  /**
   * @param {string} id - Compound ID or just prefix for browsing all lists
   * @returns {Promise<ListableItem[]|ListableItem|null>}
   */
  async getList(id) {
    // Strip source prefix only when it wraps a known list prefix
    const strippedId = id.replace(/^list:(?=(menu|program|watchlist|query):)/, '');

    // Handle "menu:", "program:", "watchlist:", "query:" - return all lists of that type
    const prefixMatch = strippedId.match(/^(menu|program|watchlist|query):$/);
    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const listType = this._getListType(prefix);
      const names = this._getAllListNames(listType);

      return names.map(name => {
        const listData = this._loadList(listType, name);
        const items = listData?.sections?.flatMap(s => s.items) || [];
        const title = listData?.title || formatListTitle(name);

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

    const items = listData.sections.flatMap(s => s.items);
    const menuFixedOrder = listData.metadata?.fixed_order;
    const children = await this._buildListItems(items, parsed.prefix, parsed.name, listData.metadata);

    // Propagate menu-level fixed_order to all children
    if (menuFixedOrder) {
      for (const child of children) {
        if (child.metadata) child.metadata.fixedOrder = true;
      }
    }

    const title = listData.title || formatListTitle(parsed.name);

    // Try to get thumbnail from list config or first item
    let thumbnail = listData.image || null;
    if (!thumbnail && items.length > 0 && items[0].image) {
      thumbnail = items[0].image;
    }

    const canonicalId = `${parsed.prefix}:${parsed.name}`;

    return new ListableItem({
      id: canonicalId,
      source: 'list',
      localId: canonicalId,
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

  // ─── Watch-state helpers (ported from FolderAdapter) ─────────────────

  /**
   * Calculate priority for an item based on watch state and scheduling
   * @param {Object} item - Watchlist item
   * @param {Object} watchState - Watch state for this item
   * @returns {string} Priority: 'in_progress', 'urgent', 'high', 'medium', 'low'
   */
  _calculatePriority(item, watchState) {
    return watchlistPriority(item, watchState, Date.now());
  }

  /**
   * Check if an enriched child item should be skipped for playback.
   * Used by resolvePlayables() to filter items based on watch state and scheduling.
   * @param {Object} child - Enriched Item from getList()
   * @returns {boolean} True if item should be skipped for playback
   */
  _shouldSkipForPlayback(child) {
    const tz = this.configService?.getTimezone?.() || 'America/Los_Angeles';
    return shouldSkipListPlayback(child.metadata, { today: getCurrentDate(tz), nowMs: Date.now() });
  }

  /**
   * Check if a Plex item has a nomusic label
   * @param {string} plexId - Plex rating key
   * @returns {Promise<boolean>}
   */
  async _hasNomusicLabel(plexId) {
    if (!this.nomusicLabels?.length || !plexId || !this.registry) return false;

    if (!this._nomusicCache) this._nomusicCache = {};
    if (plexId in this._nomusicCache) return this._nomusicCache[plexId];

    try {
      const adapter = this.registry.get('plex');
      if (!adapter?.getItem) return false;

      const item = await adapter.getItem(`plex:${plexId}`);
      const labels = item?.metadata?.labels || [];

      const normalizedLabels = labels
        .map(l => (typeof l === 'string' ? l.toLowerCase().trim() : ''))
        .filter(Boolean);

      const nomusicSet = new Set(this.nomusicLabels.map(l => l.toLowerCase().trim()));
      const result = normalizedLabels.some(l => nomusicSet.has(l));

      this._nomusicCache[plexId] = result;
      return result;
    } catch (err) {
      this._nomusicCache[plexId] = false;
      return false;
    }
  }

  /**
   * Get the single "next up" playable from a child source.
   * Uses watch state to find: in_progress > unwatched > first
   *
   * @param {Object} child - Child item from watchlist
   * @param {Object} resolved - Resolved registry entry {adapter, localId}
   * @returns {Promise<Object|null>}
   * @private
   */
  async _getNextPlayableFromChild(child, resolved) {
    const { adapter } = resolved;

    // Build canonical ID from resolved info so legacy prefixes (e.g. "scriptures:")
    // are translated to the adapter's expected format (e.g. "readalong:scripture/...")
    const canonicalId = `${adapter.source}:${resolved.localId}`;

    // Fast path: adapter with built-in smart selection (PlexAdapter)
    // Uses drill-down (show→season→episode) + bulk history instead of resolving ALL episodes
    if (adapter.loadPlayableItemFromKey) {
      const storagePath = (adapter.getStoragePath ? await adapter.getStoragePath(child.id) : null) || child.source || 'plex';
      const item = await adapter.loadPlayableItemFromKey(child.id, { storagePath });
      return item || null;
    }

    let items = [];
    if (adapter.resolvePlayables) {
      // Only need a few items to find next playable (in-progress > unwatched > first)
      items = await adapter.resolvePlayables(canonicalId, { limit: 10 });
    } else if (adapter.getItem) {
      const item = await adapter.getItem(canonicalId);
      if (item?.mediaUrl || item?.isPlayable?.()) {
        items = [item];
      }
    }

    if (!items || items.length === 0) return null;
    if (items.length === 1) return items[0];

    const storagePath = (adapter.getStoragePath ? await adapter.getStoragePath(canonicalId) : null) || child.source || 'files';

    if (!this.mediaProgressMemory) {
      return items[0];
    }

    // Bulk-load progress for this storage path (1 read instead of 2N sequential .get() calls)
    const allProgress = await this.mediaProgressMemory.listProgress(storagePath);
    const progressMap = new Map();
    for (const p of allProgress) {
      progressMap.set(p.contentId, p);
    }

    // First pass: find any in-progress item.
    // Uses QueueService.isWatched (duration-aware) so a 28s poem stuck at
    // 71% isn't treated as in-progress forever — see SHORT_WATCHED_THRESHOLD.
    for (const item of items) {
      const state = progressMap.get(item.id);
      const percent = state?.percent || 0;
      if (percent > 1 && !QueueService.isWatched({ duration: item.duration, percent })) {
        return item;
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const state = progressMap.get(item.id);
      const percent = state?.percent || 0;
      if (!QueueService.isWatched({ duration: item.duration, percent })) {
        return item;
      }
    }

    // All watched - return first item as fallback
    return items[0];
  }

  /**
   * Pick playables via an explicit ItemSelectionService strategy.
   * Used by program slots that declare `strategy:` in YAML — e.g.
   * `strategy: rotation` for shuffle-without-repeat.
   *
   * Enriches items with watch-state percent so `filter: ['watched']`
   * (used by rotation, freshvideo, etc.) actually filters.
   *
   * @param {string} strategyName
   * @param {Object} resolved - { adapter, localId } from registry.resolve
   * @param {Object} child - { id, source } describing the source prefix
   * @returns {Promise<Array>}
   * @private
   */
  async _pickViaStrategy(strategyName, resolved, child) {
    const { adapter } = resolved;
    const canonicalId = `${adapter.source}:${resolved.localId}`;
    const allItems = await adapter.resolvePlayables(canonicalId);
    if (!allItems?.length) return [];

    let enriched = allItems;
    if (this.mediaProgressMemory) {
      const storagePath = (adapter.getStoragePath ? await adapter.getStoragePath(canonicalId) : null)
        || child.source
        || 'files';
      const allProgress = await this.mediaProgressMemory.listProgress(storagePath);
      const map = new Map(allProgress.map(p => [p.contentId, p]));
      enriched = allItems.map(it => ({ ...it, percent: map.get(it.id)?.percent || 0 }));
    }

    return ItemSelectionService.select(
      enriched,
      { now: new Date() },
      { strategy: strategyName, allowFallback: true, random: Math.random }
    );
  }

  // ─── List building ─────────────────────────────────────────────────

  /**
   * Build Item objects from list items
   * @param {Array} items - Raw items from YAML
   * @param {string} listPrefix - 'menu', 'program', 'watchlist'
   * @returns {Promise<Item[]>}
   */
  async _buildListItems(items, listPrefix, listName, listMetadata = {}) {
    const isWatchlist = listPrefix === 'watchlist';

    // Map source names to watch state categories (for watchlist enrichment)
    const watchCategoryMap = {
      plex: 'plex',
      list: null,
      primary: 'songs',
      hymn: 'songs',
      scripture: 'scripture',
      talk: 'talks',
      files: 'files',
      media: 'files'
    };

    const results = [];

    // Bulk-load progress once per namespace/category instead of one disk read
    // per child. mediaProgressMemory.findProgress() → _readFile() does an uncached
    // fs.readFileSync + yaml.load on EVERY call, so the old per-item lookup
    // re-parsed the same YAML N times (a 447-child scripture watchlist re-read
    // scriptures.yml 447×, ~4.3s). Mirror the bulk-load in
    // _getNextPlayableFromChild(): read each category file once into a Map.
    const progressByCategory = new Map(); // watchCategory -> Map(assetId -> MediaProgress)
    const getCategoryProgress = async (watchCategory) => {
      let map = progressByCategory.get(watchCategory);
      if (!map) {
        map = new Map();
        const all = await this.mediaProgressMemory.listProgress(watchCategory);
        for (const p of all) map.set(p.contentId, p);
        progressByCategory.set(watchCategory, map);
      }
      return map;
    };

    for (const item of items) {
      if (item.active === false) continue;

      // Android items are client-side only (FKB app launch) — pass through without content resolution
      if (item.android) {
        results.push({
          id: `android:${item.android.package}/${item.android.activity}`,
          title: item.title,
          thumbnail: item.image,
          itemType: 'leaf',
          metadata: { uid: item.uid },
          android: item.android
        });
        continue;
      }

      // Extract content ID from normalized item (play/list/queue/display action keys or legacy input)
      const contentId = extractContentId(item);
      let source = 'list';
      let localId = contentId;

      // Handle various input formats (trim whitespace after colon for YAML compat)
      const inputMatch = contentId.match(/^(\w+):\s*(.+?)(?:;.*)?$/);
      if (inputMatch) {
        source = inputMatch[1];
        localId = inputMatch[2].trim();
      }

      if (source === 'list') {
        source = 'menu';
      }

      // Build the asset ID for watch state lookup
      const assetId = item.assetId || localId;

      // Determine action type from YAML (default to Play)
      const actionType = (item.action || 'Play').toLowerCase();

      // Build the base action key - use src override or parsed source
      const src = item.src || source;
      const normalizedSrc = src === 'list' ? 'menu' : src;
      const baseAction = {};
      baseAction[normalizedSrc] = assetId;

      // Add options to action object
      if (item.shuffle) baseAction.shuffle = true;
      if (item.continuous) baseAction.continuous = true;
      if (item.playable !== undefined) baseAction.playable = item.playable;

      // Build actions object
      const playAction = {};
      const openAction = {};
      const listAction = {};
      const queueAction = {};
      const displayAction = {};

      // Handle raw YAML action overrides first.
      // Merge baseAction first so behavior flags (shuffle/continuous/playable) propagate;
      // the explicit YAML action block overlays on top for contentId/overrides.
      if (item.play) {
        Object.assign(playAction, baseAction, item.play);
      } else if (item.open) {
        // open is a string (e.g., "family-selector/user_4") — wrap as { app: value }
        Object.assign(openAction, typeof item.open === 'string' ? { app: item.open } : item.open);
      } else if (item.queue) {
        Object.assign(queueAction, baseAction, item.queue);
      } else if (item.list) {
        Object.assign(listAction, baseAction, item.list);
      } else if (item.display) {
        Object.assign(displayAction, baseAction, item.display);
      } else if (actionType === 'open' || source === 'app') {
        Object.assign(openAction, baseAction);
      } else if (actionType === 'queue') {
        Object.assign(queueAction, baseAction);
      } else if (actionType === 'list') {
        Object.assign(listAction, baseAction);
      } else if (actionType === 'display') {
        Object.assign(displayAction, baseAction);
      } else {
        // Default: play
        Object.assign(playAction, baseAction);
      }

      // Merge display hints into the resolved action object
      if (item.menuStyle) {
        const target = listAction || queueAction || playAction;
        if (target) target.menuStyle = item.menuStyle;
      }

      // Watch-state enrichment for watchlist items
      let percent = 0;
      let playhead = 0;
      let lastPlayed = null;
      let priority = item.priority || 'medium';

      if (isWatchlist && this.mediaProgressMemory) {
        const watchCategory = listMetadata?.namespace || watchCategoryMap[source] || source;
        if (watchCategory) {
          const progressMap = await getCategoryProgress(watchCategory);
          const watchState = progressMap.get(assetId) || null;
          percent = watchState?.percent ?? 0;
          playhead = watchState?.playhead ?? 0;
          lastPlayed = watchState?.lastPlayed ?? null;
          priority = this._calculatePriority(item, watchState);
        }
      }

      // Version-aware enrichment — delegates to adapter if it supports version context
      let versionState = null;
      let contentIdOverride = null;
      if (isWatchlist && listMetadata?.versions && this.registry) {
        const resolvedAdapter = this.registry.resolve(contentId);
        if (resolvedAdapter?.adapter?.resolveVersionContext) {
          const vCtx = await resolvedAdapter.adapter.resolveVersionContext(
            resolvedAdapter.localId,
            { versions: listMetadata.versions, namespace: listMetadata.namespace }
          );
          if (vCtx) {
            percent = vCtx.percent;
            versionState = vCtx.versionState;
            contentIdOverride = vCtx.contentIdOverride;
          }
        }
      }

      // Nomusic overlay for watchlist plex items
      let finalPlayAction = playAction;
      let finalQueueAction = queueAction;

      if (isWatchlist) {
        const plexId = playAction.plex || queueAction.plex;
        if (plexId && this.musicOverlayPlaylist) {
          const hasNomusic = await this._hasNomusicLabel(plexId);
          if (hasNomusic) {
            const overlay = {
              queue: { plex: this.musicOverlayPlaylist },
              shuffle: true
            };
            if (playAction.plex && !playAction.overlay) {
              finalPlayAction = { ...playAction, overlay };
            }
            if (queueAction.plex && !queueAction.overlay) {
              finalQueueAction = { ...queueAction, overlay };
            }
          }
        }
      }

      const actions = {
        play: Object.keys(finalPlayAction).length > 0 ? finalPlayAction : undefined,
        queue: Object.keys(finalQueueAction).length > 0 ? finalQueueAction : undefined,
        list: Object.keys(listAction).length > 0 ? listAction : undefined,
        open: Object.keys(openAction).length > 0 ? openAction : undefined,
        display: Object.keys(displayAction).length > 0 ? displayAction : undefined
      };

      // Override play action contentId when version enrichment provides a rewrite
      if (contentIdOverride && actions.play) {
        actions.play = { ...actions.play, contentId: contentIdOverride };
      }

      // Build compound ID (version enrichment may override)
      const compoundId = contentIdOverride || `${source}:${localId}`;

      // Build metadata - enriched for watchlists, minimal for other list types
      const metadata = isWatchlist ? {
        category: ContentCategory.LIST,
        listType: listPrefix,
        // Watch state
        percent,
        playhead,
        lastPlayed,
        priority,
        // Scheduling fields
        hold: item.hold || false,
        watched: item.watched || false,
        skipAfter: item.skip_after || null,
        waitUntil: item.wait_until || null,
        // Grouping
        program: item.program || listName,
        // Legacy fields
        shuffle: item.shuffle,
        continuous: item.continuous,
        playable: item.playable,
        uid: item.uid,
        // Original source for reference
        src: normalizedSrc,
        assetId: assetId,
        versionState: versionState || null,
        listId: listName || null,
        // Display fields
        folder: listName,
        fixedOrder: item.fixed_order || false
      } : {
        category: ContentCategory.LIST,
        listType: listPrefix,
        days: item.days,
        applySchedule: item.applySchedule,
        fixedOrder: item.fixed_order || false
      };

      // Auto-resolve thumbnail from uploaded list images when no explicit image
      let thumbnail = item.image || null;
      if (!thumbnail && item.uid && this.configService) {
        const imgPath = path.join(this.configService.getMediaDir(), 'img', 'lists', `${item.uid}.jpg`);
        if (fileExists(imgPath)) thumbnail = `/media/img/lists/${item.uid}.jpg`;
      }

      results.push(new Item({
        id: compoundId || `${listPrefix}:${item.title || item.label}`,
        source,
        localId,
        title: item.title || item.label || localId,
        type: isWatchlist ? (actionType === 'queue' ? 'queue' : 'list') : undefined,
        thumbnail,
        metadata,
        actions
      }));
    }

    // Priority sorting for watchlist items
    if (isWatchlist) {
      const hasFixedOrder = results.some(item => item.metadata?.fixedOrder);
      if (!hasFixedOrder) {
        results.sort(compareWatchlistItems);
      }
    }

    // For programs: resolve thumbnails from would-play items
    if (listPrefix === 'program' && this.registry) {
      await Promise.all(results.map(async (item) => {
        if (item.thumbnail) return;
        const resolved = this.registry.resolve(item.id);
        if (!resolved?.adapter) return;
        try {
          const child = { id: item.id, source: item.source };
          const playable = await this._getNextPlayableFromChild(child, resolved);
          if (playable?.thumbnail) {
            item.thumbnail = playable.thumbnail;
          }
        } catch {
          // Thumbnail is decorative — skip on failure
        }
      }));
    }

    return results;
  }

  /**
   * Resolve list to playable items.
   *
   * For watchlists, applies watchlist-style filtering:
   * - Filters out: watched (>90%), on hold, past skipAfter, waitUntil >2 days
   * - play action: returns ONE playable (next up) for variety
   * - queue action: returns ALL playables for binge watching
   * - open/list actions: skipped (not playable)
   *
   * @param {string} id
   * @param {Object} options
   * @param {boolean} [options.applySchedule=true] - Apply schedule filtering for programs
   * @param {boolean} [options.forceAll=false] - If true, get all playables regardless of action type
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id, options = {}) {
    const { applySchedule = true, forceAll = false, limit = 0 } = options;

    // Strip source prefix only when it wraps a known list prefix (same as getList)
    const strippedId = id.replace(/^list:(?=(menu|program|watchlist|query):)/, '');

    const parsed = this._parseId(strippedId);
    if (!parsed) return [];

    const listType = this._getListType(parsed.prefix);
    if (!listType) return [];

    const isWatchlist = listType === 'watchlists';

    // For watchlists, use getList() to get enriched items with watch state,
    // then apply playback filtering (same approach as FolderAdapter)
    if (isWatchlist && this.registry) {
      const list = await this.getList(id);
      if (!list) return [];

      // Cascade sort for version-rotation watchlists
      // Current week: source order ASC (count up)
      // Past items: reverse source order DESC (countdown from where current week starts)
      if (list?.children?.some(c => c.metadata?.versionState)) {
        const tz = this.configService?.getTimezone?.() || 'America/Los_Angeles';
        const todayStr = getCurrentDate(tz);
        // Tag with source index for reverse ordering
        list.children.forEach((c, i) => { c._srcIdx = i; });
        list.children.sort((a, b) => {
          const ma = a.metadata || {};
          const mb = b.metadata || {};
          const cascadeA = cascadePriority(ma, todayStr);
          const cascadeB = cascadePriority(mb, todayStr);
          if (cascadeA !== cascadeB) return cascadeA - cascadeB;
          // Current week (0, 2): preserve source order ASC
          if (cascadeA === 0 || cascadeA === 2) return 0;
          // Past items (1, 3, 4): reverse source order (countdown)
          return b._srcIdx - a._srcIdx;
        });
        list.children.forEach(c => { delete c._srcIdx; });
      }

      // Build resolution tasks (preserving order) then run in parallel batches
      const tasks = [];

      for (const child of list.children) {
        // Determine action type from child's actions object
        const hasPlayAction = child.actions?.play && Object.keys(child.actions.play).length > 0;
        const hasQueueAction = child.actions?.queue && Object.keys(child.actions.queue).length > 0;
        const hasOpenAction = child.actions?.open && Object.keys(child.actions.open).length > 0;

        // Skip open/list actions - they're not playable
        if (hasOpenAction && !hasPlayAction && !hasQueueAction) {
          continue;
        }

        // Skip items that shouldn't play (watched, on hold, past skipAfter, etc.)
        if (this._shouldSkipForPlayback(child)) {
          continue;
        }

        const resolved = this.registry.resolve(child.id);
        if (!resolved?.adapter) continue;

        if (!forceAll && hasPlayAction && !hasQueueAction) {
          // Play action: get SINGLE next playable
          tasks.push(() => this._getNextPlayableFromChild(child, resolved).then(item => item ? [item] : []));
        } else {
          // Queue action: get ALL playables
          if (resolved.adapter.resolvePlayables) {
            const canonicalId = `${resolved.adapter.source}:${resolved.localId}`;
            tasks.push(() => resolved.adapter.resolvePlayables(canonicalId));
          }
        }
      }

      // Run in parallel batches to avoid overwhelming external APIs
      const BATCH_SIZE = 10;
      const playables = [];
      for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        for (const items of batchResults) {
          if (items?.length) playables.push(...items);
        }
        if (limit > 0 && playables.length >= limit) break;
      }

      // Watchlist "never empty" fallback: if all items were filtered out
      // but the list has children, resolve the first child as fallback
      if (playables.length === 0 && list.children?.length > 0) {
        const firstChild = list.children[0];
        const resolved = this.registry.resolve(firstChild.id);
        if (resolved?.adapter) {
          const fallback = await this._getNextPlayableFromChild(firstChild, resolved);
          if (fallback) playables.push(fallback);
        }
      }

      // Inject list identity into resolved playables so queue items carry listId
      for (const item of playables) {
        if (item.metadata) item.metadata.listId = parsed.name;
        else item.metadata = { listId: parsed.name };
      }

      return playables;
    }

    // Non-watchlist: original behavior (programs, menus)
    const listData = this._loadList(listType, parsed.name);
    if (!listData) return [];

    const items = listData.sections.flatMap(s => s.items);

    // Build resolution tasks (preserving order) then run sequentially for programs
    const tasks = [];

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

      // Extract content ID from normalized item (play/list/queue/display action keys or legacy input)
      const input = extractContentId(item);
      if (!input) continue;

      // Resolve through registry
      if (this.registry) {
        const resolved = this.registry.resolve(input);
        if (!resolved?.adapter) continue;

        if (listType === 'programs' && !item.queue) {
          // Programs with play action: pick ONE "next up" item per slot
          const colonIdx = input.indexOf(':');
          const child = { id: input, source: colonIdx !== -1 ? input.substring(0, colonIdx) : 'files' };
          if (item.strategy && resolved.adapter.resolvePlayables) {
            // Slot opted into an explicit selection strategy — bypass the
            // default in-progress / first-unwatched cascade and let
            // ItemSelectionService apply the named strategy. allowFallback
            // recycles the pool when fully watched so the slot never goes empty.
            tasks.push(() => this._pickViaStrategy(item.strategy, resolved, child));
          } else {
            tasks.push(() => this._getNextPlayableFromChild(child, resolved).then(item => item ? [item] : []));
          }
        } else {
          // Queue action (programs) or menus: return ALL playables
          if (resolved.adapter.resolvePlayables) {
            const canonicalId = `${resolved.adapter.source}:${resolved.localId}`;
            const shouldShuffle = !!item.shuffle;
            tasks.push(async () => {
              const resolved_items = await resolved.adapter.resolvePlayables(canonicalId);
              if (shouldShuffle && resolved_items?.length > 1) {
                for (let i = resolved_items.length - 1; i > 0; i--) {
                  const j = Math.floor(Math.random() * (i + 1));
                  [resolved_items[i], resolved_items[j]] = [resolved_items[j], resolved_items[i]];
                }
              }
              return resolved_items;
            });
          }
        }
      }
    }

    // Run resolution tasks — sequential for programs (order matters), batched for menus
    const BATCH_SIZE = 10;
    const playables = [];
    if (listType === 'programs') {
      // Sequential: program queue order must match config order
      for (let t = 0; t < tasks.length; t++) {
        const items = await tasks[t]();
        if (items?.length) playables.push(...items);
        if (limit > 0 && playables.length >= limit) break;
      }
    } else {
      for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(fn => fn()));
        for (const items of batchResults) {
          if (items?.length) playables.push(...items);
        }
        if (limit > 0 && playables.length >= limit) break;
      }
    }

    // Programs are pre-ordered sequences — flag to skip watch-state reordering
    if (listType === 'programs') {
      playables.preserveOrder = true;
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
  // Note: Query resolution (query:dailynews etc.) is now handled by QueryAdapter.
  // See backend/src/1_adapters/content/query/QueryAdapter.mjs

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

        const title = listData.title || name;

        // Check if list name matches
        if (name.toLowerCase().includes(searchLower) ||
            title.toLowerCase().includes(searchLower)) {
          results.push(await this.getItem(`${prefix}:${name}`));
        }

        // Check if any item titles match
        const items = listData.sections?.flatMap(s => s.items) || [];
        for (const item of items) {
          if ((item.title || item.label)?.toLowerCase().includes(searchLower)) {
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
    this._nomusicCache = {};
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    const parsed = this._parseId(id);
    if (!parsed) return 'list';

    // For watchlist prefix, use folder-style storage path for backward compatibility
    if (parsed.prefix === 'watchlist') {
      return `folder_${parsed.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    return `list_${parsed.prefix}`;
  }

  // ---------------------------------------------------------------------------
  // Sibling resolution (ISiblingsCapable)
  // ---------------------------------------------------------------------------

  /** @type {Set<string>} Known list type prefixes */
  static #LIST_PREFIXES = new Set(['menu', 'program', 'watchlist', 'query', 'list']);

  /**
   * Resolve siblings for list items.
   * When the request targets a list-type prefix root (e.g., "menu:"),
   * returns all lists of that type as siblings.
   * Returns null for specific list items to let the default fallback handle them.
   *
   * @param {string} compoundId - e.g., "menu:fhe", "menu:", "watchlist:"
   * @returns {Promise<{parent: Object, items: Array}|null>}
   */
  async resolveSiblings(compoundId) {
    const colonIdx = compoundId.indexOf(':');
    const prefix = colonIdx !== -1 ? compoundId.substring(0, colonIdx) : compoundId;
    const name = colonIdx !== -1 ? compoundId.substring(colonIdx + 1) : '';

    if (!ListAdapter.#LIST_PREFIXES.has(prefix)) {
      return null; // Not a recognized list prefix
    }

    // Normalize 'list' → 'menu'
    const listPrefix = prefix === 'list' ? 'menu' : prefix;

    // If a specific list name is given, find its siblings (other lists of same type)
    // If no name (root request), list all of this type
    const listResult = await this.getList(`${listPrefix}:`);
    const listItems = Array.isArray(listResult) ? listResult : (listResult?.children || []);
    const titleized = listPrefix.charAt(0).toUpperCase() + listPrefix.slice(1);
    const parent = {
      id: `${listPrefix}:`,
      title: `${titleized}s`,
      source: 'list',
      thumbnail: listItems[0]?.thumbnail || null,
      parentId: null,
      libraryId: null
    };

    return { parent, items: listItems };
  }
}

export default ListAdapter;
