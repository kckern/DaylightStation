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

// Threshold for considering an item "watched" (90%)
const WATCHED_THRESHOLD = 90;
// Minimum progress to count as "in progress"
const MIN_PROGRESS_THRESHOLD = 1;

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
    const householdSuffix = this.householdId ? `-${this.householdId}` : '';

    // Try exact match first (household-specific, then default)
    for (const base of [`household${householdSuffix}`, 'household']) {
      const exact = path.join(this.dataPath, base, 'config', 'lists', listType, `${name}.yml`);
      if (fileExists(exact)) return exact;
    }

    // Try case-insensitive match in the target directory
    const caseMatch = this._findFileInsensitive(listType, name);
    if (caseMatch) return caseMatch;

    // For watchlist: prefix, fall back to menus/ directory (backward compat with FolderAdapter)
    if (listType === 'watchlists') {
      for (const base of [`household${householdSuffix}`, 'household']) {
        const menuPath = path.join(this.dataPath, base, 'config', 'lists', 'menus', `${name}.yml`);
        if (fileExists(menuPath)) return menuPath;
      }
      const menuCaseMatch = this._findFileInsensitive('menus', name);
      if (menuCaseMatch) return menuCaseMatch;
    }

    // Return default path (will fail gracefully in _loadList)
    return path.join(this.dataPath, 'household', 'config', 'lists', listType, `${name}.yml`);
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
    const householdSuffix = this.householdId ? `-${this.householdId}` : '';

    for (const base of [`household${householdSuffix}`, 'household']) {
      const dir = path.join(this.dataPath, base, 'config', 'lists', listType);
      if (!dirExists(dir)) continue;

      const entries = listEntries(dir);
      for (const entry of entries) {
        if (entry.toLowerCase() === `${nameLower}.yml` || entry.toLowerCase() === `${nameLower}.yaml`) {
          return path.join(dir, entry);
        }
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
    const children = await this._buildListItems(items, parsed.prefix, parsed.name);
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

  // ─── Watch-state helpers (ported from FolderAdapter) ─────────────────

  /**
   * Check if an item is considered "watched" (>90% or <60s remaining)
   * @param {Object} watchState - { percent, playhead, duration }
   * @returns {boolean}
   */
  _isWatched(watchState) {
    if (!watchState) return false;
    const percent = watchState.percent ?? 0;
    const playhead = watchState.playhead ?? 0;
    const duration = watchState.duration ?? 0;

    if (percent >= WATCHED_THRESHOLD) return true;

    if (duration > 0 && playhead > 0) {
      const remaining = duration - playhead;
      if (remaining < 60) return true;
    }

    return false;
  }

  /**
   * Calculate priority for an item based on watch state and scheduling
   * @param {Object} item - Watchlist item
   * @param {Object} watchState - Watch state for this item
   * @returns {string} Priority: 'in_progress', 'urgent', 'high', 'medium', 'low'
   */
  _calculatePriority(item, watchState) {
    const percent = watchState?.percent || 0;

    if (percent > MIN_PROGRESS_THRESHOLD) {
      return 'in_progress';
    }

    if (item.skipAfter) {
      const skipDate = new Date(item.skipAfter);
      const eightDaysFromNow = new Date();
      eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);
      if (skipDate <= eightDaysFromNow) {
        return 'urgent';
      }
    }

    return item.priority || 'medium';
  }

  /**
   * Check if an enriched child item should be skipped for playback.
   * Used by resolvePlayables() to filter items based on watch state and scheduling.
   * @param {Object} child - Enriched Item from getList()
   * @returns {boolean} True if item should be skipped for playback
   */
  _shouldSkipForPlayback(child) {
    const meta = child.metadata || {};

    if (meta.hold) return true;
    if (meta.percent >= WATCHED_THRESHOLD) return true;
    if (meta.watched) return true;

    if (meta.skipAfter) {
      const skipDate = new Date(meta.skipAfter);
      if (skipDate < new Date()) return true;
    }

    if (meta.waitUntil) {
      const waitDate = new Date(meta.waitUntil);
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      if (waitDate > twoDaysFromNow) return true;
    }

    return false;
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

    let items = [];
    if (adapter.resolvePlayables) {
      items = await adapter.resolvePlayables(child.id);
    } else if (adapter.getItem) {
      const item = await adapter.getItem(child.id);
      if (item?.mediaUrl || item?.isPlayable?.()) {
        items = [item];
      }
    }

    if (!items || items.length === 0) return null;
    if (items.length === 1) return items[0];

    const storagePath = adapter.getStoragePath?.(child.id) || child.source || 'files';

    if (!this.mediaProgressMemory) {
      return items[0];
    }

    // First pass: find any in-progress item
    for (const item of items) {
      const mediaKey = item.localId || item.id.split(':')[1];
      const state = await this.mediaProgressMemory.get(mediaKey, storagePath);
      const percent = state?.percent || 0;
      if (percent > 1 && percent < 90) {
        return item;
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const mediaKey = item.localId || item.id.split(':')[1];
      const state = await this.mediaProgressMemory.get(mediaKey, storagePath);
      const percent = state?.percent || 0;
      if (percent < 90) {
        return item;
      }
    }

    // All watched - return first item as fallback
    return items[0];
  }

  // ─── List building ─────────────────────────────────────────────────

  /**
   * Build Item objects from list items
   * @param {Array} items - Raw items from YAML
   * @param {string} listPrefix - 'menu', 'program', 'watchlist'
   * @returns {Promise<Item[]>}
   */
  async _buildListItems(items, listPrefix, listName) {
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

    for (const item of items) {
      if (item.active === false) continue;

      // Parse input field to determine source
      const input = item.input || '';
      let source = 'list';
      let localId = input;

      // Handle various input formats (trim whitespace after colon for YAML compat)
      const inputMatch = input.match(/^(\w+):\s*(.+?)(?:;.*)?$/);
      if (inputMatch) {
        source = inputMatch[1];
        localId = inputMatch[2].trim();
      }

      // Build the asset ID for watch state lookup
      const assetId = item.assetId || localId;

      // Determine action type from YAML (default to Play)
      const actionType = (item.action || 'Play').toLowerCase();

      // Build the base action key - use src override or parsed source
      const src = item.src || source;
      const baseAction = {};
      baseAction[src] = assetId;

      // Add options to action object
      if (item.shuffle) baseAction.shuffle = true;
      if (item.continuous) baseAction.continuous = true;
      if (item.playable !== undefined) baseAction.playable = item.playable;

      // Build actions object
      const playAction = {};
      const openAction = {};
      const listAction = {};
      const queueAction = {};

      // Handle raw YAML action overrides first
      if (item.play) {
        Object.assign(playAction, item.play);
      } else if (item.open) {
        Object.assign(openAction, item.open);
      } else if (item.queue) {
        Object.assign(queueAction, item.queue);
      } else if (item.list) {
        Object.assign(listAction, item.list);
      } else if (actionType === 'open' || source === 'app') {
        Object.assign(openAction, baseAction);
      } else if (actionType === 'queue') {
        Object.assign(queueAction, baseAction);
      } else if (actionType === 'list') {
        Object.assign(listAction, baseAction);
      } else {
        // Default: play
        Object.assign(playAction, baseAction);
      }

      // Watch-state enrichment for watchlist items
      let percent = 0;
      let playhead = 0;
      let lastPlayed = null;
      let priority = item.priority || 'medium';

      if (isWatchlist && this.mediaProgressMemory) {
        const watchCategory = watchCategoryMap[source] ?? source;
        if (watchCategory) {
          const watchState = await this.mediaProgressMemory.get(assetId, watchCategory);
          percent = watchState?.percent ?? 0;
          playhead = watchState?.playhead ?? 0;
          lastPlayed = watchState?.lastPlayed ?? null;
          priority = this._calculatePriority(item, watchState);
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
        open: Object.keys(openAction).length > 0 ? openAction : undefined
      };

      // Build compound ID
      const compoundId = `${source}:${localId}`;

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
        skipAfter: item.skipAfter || null,
        waitUntil: item.waitUntil || null,
        // Grouping
        program: item.program || listName,
        // Legacy fields
        shuffle: item.shuffle,
        continuous: item.continuous,
        playable: item.playable,
        uid: item.uid,
        // Original source for reference
        src: item.src || source,
        assetId: assetId,
        // Display fields
        folder: listName,
        fixedOrder: item.fixed_order || false
      } : {
        category: ContentCategory.LIST,
        listType: listPrefix,
        days: item.days,
        applySchedule: item.applySchedule
      };

      results.push(new Item({
        id: compoundId || `${listPrefix}:${item.label}`,
        source,
        localId,
        title: item.label || localId,
        type: isWatchlist ? (actionType === 'queue' ? 'queue' : 'list') : undefined,
        thumbnail: item.image,
        metadata,
        actions
      }));
    }

    // Priority sorting for watchlist items
    if (isWatchlist) {
      const hasFixedOrder = results.some(item => item.metadata?.fixedOrder);
      if (!hasFixedOrder) {
        const priorityOrder = ['in_progress', 'urgent', 'high', 'medium', 'low'];
        results.sort((a, b) => {
          const priorityA = priorityOrder.indexOf(a.metadata?.priority || 'medium');
          const priorityB = priorityOrder.indexOf(b.metadata?.priority || 'medium');

          if (priorityA !== priorityB) {
            return priorityA - priorityB;
          }

          // For in_progress items, sort by higher percent first
          if (a.metadata?.priority === 'in_progress' && b.metadata?.priority === 'in_progress') {
            return (b.metadata?.percent || 0) - (a.metadata?.percent || 0);
          }

          return 0;
        });
      }
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
    const { applySchedule = true, forceAll = false } = options;

    const parsed = this._parseId(id);
    if (!parsed) return [];

    // Handle query: prefix specially
    if (parsed.prefix === 'query') {
      return this._resolveQuery(parsed.name);
    }

    const listType = this._getListType(parsed.prefix);
    if (!listType) return [];

    const isWatchlist = listType === 'watchlists';

    // For watchlists, use getList() to get enriched items with watch state,
    // then apply playback filtering (same approach as FolderAdapter)
    if (isWatchlist && this.registry) {
      const list = await this.getList(id);
      if (!list) return [];

      const playables = [];

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

        // For play action (or no explicit action type), get SINGLE next playable
        if (!forceAll && hasPlayAction && !hasQueueAction) {
          const nextItem = await this._getNextPlayableFromChild(child, resolved);
          if (nextItem) {
            playables.push(nextItem);
          }
          continue;
        }

        // For queue action, get ALL playables
        if (resolved.adapter.resolvePlayables) {
          const childPlayables = await resolved.adapter.resolvePlayables(child.id);
          playables.push(...childPlayables);
        }
      }

      return playables;
    }

    // Non-watchlist: original behavior (programs, menus)
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
    const mediaAdapter = this.registry?.get('files');

    if (!mediaAdapter) {
      console.warn('[ListAdapter] FileAdapter not available for freshvideo query');
      return [];
    }

    // Collect videos from each source with priority
    for (let i = 0; i < sources.length; i++) {
      const sourcePath = sources[i];
      const videoPath = `video/${sourcePath}`;

      try {
        // Get list of videos from the source directory
        const items = await mediaAdapter.getList(videoPath);

        for (const item of items) {
          if (item.itemType !== 'leaf') continue;

          // Extract date from filename (YYYYMMDD.mp4 -> YYYYMMDD)
          const filename = item.localId?.split('/').pop() || '';
          const dateMatch = filename.match(/^(\d{8})/);
          const date = dateMatch ? dateMatch[1] : '00000000';

          // Get full item with media URL
          const fullItem = await mediaAdapter.getItem(item.localId);
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
        const mediaKey = item.localId || item.id?.replace(/^(files|media):/, '');
        const state = await this.mediaProgressMemory.get(mediaKey, 'files');
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
}

export default ListAdapter;
