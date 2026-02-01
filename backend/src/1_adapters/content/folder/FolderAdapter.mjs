// backend/src/2_adapters/content/folder/FolderAdapter.mjs
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { Item } from '#domains/content/entities/Item.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { loadYaml } from '#system/utils/FileIO.mjs';

// Threshold for considering an item "watched" (90%)
const WATCHED_THRESHOLD = 90;
// Minimum progress to count as "in progress"
const MIN_PROGRESS_THRESHOLD = 1;

/**
 * Adapter for custom folders/watchlists containing mixed-source items.
 * Supports watch state integration for priority-based ordering.
 *
 * ## Display vs Playback Filtering
 *
 * This adapter separates concerns between displaying lists and building playback queues:
 *
 * **getList()** - For menu/UI display
 * - Returns ALL items (only filters `active: false`)
 * - Enriches items with watch state for UI indicators (progress bars, "watched" badges)
 * - Example: Show "Felix" in FHE menu even if his assigned video was watched
 *
 * **resolvePlayables()** - For automated playback queues
 * - Filters out: watched (>90%), on hold, past skipAfter, waitUntil >2 days
 * - Example: Skip already-watched videos when building a playlist
 *
 * ## Filtering Rules
 *
 * | Filter              | getList (display) | resolvePlayables (playback) |
 * |---------------------|-------------------|----------------------------|
 * | `active: false`     | Hide              | Skip                       |
 * | Watched >90%        | Show              | Skip                       |
 * | `watched: true`     | Show              | Skip                       |
 * | `hold: true`        | Show              | Skip                       |
 * | `skipAfter` passed | Show              | Skip                       |
 * | `waitUntil` >2 days| Show              | Skip                       |
 */
export class FolderAdapter {
  constructor(config) {
    if (!config.watchlistPath) throw new InfrastructureError('FolderAdapter requires watchlistPath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'watchlistPath'
      });
    this.watchlistPath = config.watchlistPath;
    this.registry = config.registry || null;
    this.mediaProgressMemory = config.mediaProgressMemory || null;
    // Overlay config for nomusic items
    this.nomusicLabels = config.nomusicLabels || [];
    this.musicOverlayPlaylist = config.musicOverlayPlaylist || null;
    this._watchlistCache = null;
  }

  get source() {
    return 'folder';
  }

  get prefixes() {
    return [
      { prefix: 'folder' },
      { prefix: 'local' }
    ];
  }

  canResolve(id) {
    return id.startsWith('folder:');
  }

  getStoragePath(id) {
    const folderName = id.replace('folder:', '');
    return `folder_${folderName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  _loadWatchlist() {
    if (this._watchlistCache) return this._watchlistCache;
    try {
      // loadYaml handles .yml/.yaml automatically
      const data = loadYaml(this.watchlistPath.replace(/\.(yml|yaml)$/, ''));
      this._watchlistCache = data || [];
      return this._watchlistCache;
    } catch (err) {
      return [];
    }
  }

  /**
   * Check if a Plex item has a nomusic label
   * @param {string} plexId - Plex rating key
   * @returns {Promise<boolean>}
   */
  async _hasNomusicLabel(plexId) {
    if (!this.nomusicLabels.length || !plexId || !this.registry) return false;

    // Cache results per adapter instance to avoid N+1 queries in loops
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

      // Cache before returning
      this._nomusicCache[plexId] = result;
      return result;
    } catch (err) {
      this._nomusicCache[plexId] = false;
      return false;
    }
  }

  /**
   * Check if an item is considered "watched" (>90% or <60s remaining)
   * @param {Object} watchState - { percent, seconds, playhead, mediaDuration }
   * @returns {boolean}
   */
  _isWatched(watchState) {
    if (!watchState) return false;
    const percent = watchState.percent || 0;
    const playhead = watchState.playhead || watchState.seconds || 0;
    const duration = watchState.mediaDuration || 0;

    // Watched if >= 90%
    if (percent >= WATCHED_THRESHOLD) return true;

    // Watched if less than 60 seconds remaining
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

    // In progress if partially watched
    if (percent > MIN_PROGRESS_THRESHOLD) {
      return 'in_progress';
    }

    // Check for urgent based on skipAfter deadline
    if (item.skipAfter) {
      const skipDate = new Date(item.skipAfter);
      const eightDaysFromNow = new Date();
      eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);
      if (skipDate <= eightDaysFromNow) {
        return 'urgent';
      }
    }

    // Use item's specified priority or default to medium
    return item.priority || 'medium';
  }

  /**
   * Check if an enriched child item should be skipped for playback
   * Used by resolvePlayables() to filter items based on watch state and scheduling
   * @param {Object} child - Enriched Item from getList()
   * @returns {boolean} True if item should be skipped for playback
   */
  _shouldSkipForPlayback(child) {
    const meta = child.metadata || {};

    // Skip if on hold
    if (meta.hold) return true;

    // Skip if watched (>90%)
    if (meta.percent >= WATCHED_THRESHOLD) return true;

    // Skip if marked as watched
    if (meta.watched) return true;

    // Skip if past skipAfter date
    if (meta.skipAfter) {
      const skipDate = new Date(meta.skipAfter);
      if (skipDate < new Date()) return true;
    }

    // Skip if waitUntil is more than 2 days away
    if (meta.waitUntil) {
      const waitDate = new Date(meta.waitUntil);
      const twoDaysFromNow = new Date();
      twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
      if (waitDate > twoDaysFromNow) return true;
    }

    return false;
  }

  /**
   * Parse input string to extract source and id
   * Formats: "plex: 123", "list: FolderName", "primary: 2", "media: path/to/file"
   */
  _parseInput(input) {
    if (!input) return null;
    const match = input.match(/^(\w+):\s*(.+?)(?:;.*)?$/);
    if (!match) return null;
    const [, source, value] = match;
    return { source: source.toLowerCase(), id: value.trim() };
  }

  /**
   * Get list of items in a folder with watch state enrichment
   * Returns all items for display (only filters active:false).
   * Use resolvePlayables() for playback-filtered lists.
   * @param {string} id - Folder ID (folder:FolderName)
   * @returns {Promise<ListableItem|null>}
   */
  async getList(id) {
    const folderName = id.replace('folder:', '');
    const watchlist = this._loadWatchlist();

    // Normalize folder name: handle URL encoding quirks (+, %20) and case
    const normalizeFolderName = (name) => {
      if (!name) return '';
      return decodeURIComponent(name.replace(/\+/g, ' ')).toLowerCase().trim();
    };

    // Filter items belonging to this folder (case-insensitive, URL-encoding normalized)
    const folderNameNorm = normalizeFolderName(folderName);
    const folderItems = watchlist.filter(item => normalizeFolderName(item.folder) === folderNameNorm);
    if (folderItems.length === 0) return null;

    // Map source names to content source types and watch state categories
    const sourceMap = {
      plex: { source: 'plex', category: 'plex' },
      list: { source: 'folder', category: null },
      primary: { source: 'local-content', category: 'songs' },
      hymn: { source: 'local-content', category: 'songs' },
      scripture: { source: 'local-content', category: 'scripture' },
      talk: { source: 'local-content', category: 'talks' },
      media: { source: 'filesystem', category: 'media' }
    };

    const children = [];

    for (const item of folderItems) {
      // Only filter on explicit inactive flag (for display purposes)
      if (item.active === false) continue;

      const parsed = this._parseInput(item.input);
      if (!parsed) continue;

      const mapping = sourceMap[parsed.source] || { source: parsed.source, category: parsed.source };
      const contentSource = mapping.source;
      const watchCategory = mapping.category;

      // Build the asset ID for watch state lookup
      const assetId = item.assetId || parsed.id;

      // Load watch state from mediaProgressMemory (for UI indicators, not filtering)
      let watchState = null;
      if (watchCategory && this.mediaProgressMemory) {
        watchState = await this.mediaProgressMemory.get(assetId, watchCategory);
      }

      // Calculate priority based on watch state and scheduling
      const priority = this._calculatePriority(item, watchState);

      // Extract watch progress and lastPlayed
      const percent = watchState?.percent || 0;
      const seconds = watchState?.seconds || watchState?.playhead || 0;
      const lastPlayed = watchState?.lastPlayed || null;

      const compoundId = `${contentSource}:${parsed.id}`;

      // Build action object based on YAML action field
      // Frontend expects: queue: {...}, list: {...}, play: {...}, open: {...}
      const playAction = {};
      const openAction = {};
      const listAction = {};
      const queueAction = {};  // For queue actions

      // Determine action type from YAML (default to Play)
      const actionType = (item.action || 'Play').toLowerCase();

      // Build the base action object with source and key
      const baseAction = {};
      const src = item.src || parsed.source;
      baseAction[src] = assetId;

      // Add options to action object (not just metadata)
      if (item.shuffle) baseAction.shuffle = true;
      if (item.continuous) baseAction.continuous = true;
      if (item.playable !== undefined) baseAction.playable = item.playable;

      // Handle raw YAML overrides first
      if (item.play) {
        Object.assign(playAction, item.play);
      } else if (item.open) {
        Object.assign(openAction, item.open);
      } else if (item.queue) {
        Object.assign(queueAction, item.queue);
      } else if (item.list) {
        Object.assign(listAction, item.list);
      } else if (actionType === 'open' || parsed.source === 'app') {
        // Open action for app launches
        Object.assign(openAction, baseAction);
      } else if (actionType === 'queue') {
        // Queue action for shuffle/continuous playback
        Object.assign(queueAction, baseAction);
      } else if (actionType === 'list') {
        // List action for submenus and collections
        Object.assign(listAction, baseAction);
      } else {
        // Play action (default)
        Object.assign(playAction, baseAction);
      }

      // Check if this is a Plex item with nomusic label that needs overlay
      let finalPlayAction = playAction;
      let finalQueueAction = queueAction;

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

      children.push(new Item({
        id: compoundId,
        source: contentSource,
        localId: parsed.id,
        title: item.label || parsed.id,
        type: item.action === 'Queue' ? 'queue' : 'list',
        thumbnail: item.image,
        metadata: {
          // Watch state
          percent,
          seconds,
          lastPlayed,
          priority,
          // Scheduling fields
          hold: item.hold || false,
          watched: item.watched || false,
          skipAfter: item.skipAfter || null,
          waitUntil: item.waitUntil || null,
          // Grouping
          program: item.program || folderName,
          // Legacy fields
          shuffle: item.shuffle,
          continuous: item.continuous,
          playable: item.playable,
          uid: item.uid,
          // Original source for reference
          src: item.src || parsed.source,
          assetId: assetId,
          // Legacy display fields
          folder: folderName,
          folderColor: item.folderColor || null
        },
        // Actions object
        actions: {
          queue: Object.keys(finalQueueAction).length > 0 ? finalQueueAction : undefined,
          list: Object.keys(listAction).length > 0 ? listAction : undefined,
          play: Object.keys(finalPlayAction).length > 0 ? finalPlayAction : undefined,
          open: Object.keys(openAction).length > 0 ? openAction : undefined
        }
      }));
    }

    // Check if any item has folderColor - if so, maintain fixed order from YAML
    // (Legacy behavior: folderColor indicates "no dynamic sorting")
    const hasFixedOrder = children.some(item => item.metadata?.folderColor);

    if (!hasFixedOrder) {
      // Sort by priority: in_progress > urgent > high > medium > low
      const priorityOrder = ['in_progress', 'urgent', 'high', 'medium', 'low'];
      children.sort((a, b) => {
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

    return new ListableItem({
      id,
      source: 'folder',
      localId: folderName,
      title: folderName,
      itemType: 'container',
      children
    });
  }

  async getItem(id) {
    const localId = id.replace('folder:', '');
    const list = await this.getList(id);
    if (!list) return null;
    return new ListableItem({
      id,
      source: 'folder',
      localId,
      title: list.title,
      itemType: 'container',
      childCount: list.children.length,
      children: list.children
    });
  }

  /**
   * Resolve folder to playable items for automated playback.
   *
   * Unlike getList(), this method filters out items that shouldn't play:
   * - watched >90%, on hold, past skipAfter, waitUntil >2 days
   *
   * Key behavior based on action type:
   * - play action: returns ONE playable (next up) - for daily programming variety
   * - queue action: returns ALL playables - for binge watching
   * - open/list actions: skipped (not playable)
   *
   * @param {string} id - Folder ID
   * @param {Object} options
   * @param {boolean} [options.forceAll=false] - If true, get all playables regardless of action type
   * @returns {Promise<Array>}
   */
  async resolvePlayables(id, options = {}) {
    const { forceAll = false } = options;
    const list = await this.getList(id);
    if (!list || !this.registry) return [];

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
      // This creates variety and rotation in daily programming
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

  /**
   * Get the single "next up" playable from a child source.
   * Uses watch state to find: in_progress > unwatched > null
   *
   * @param {Object} child - Child item from folder
   * @param {Object} resolved - Resolved registry entry {adapter, localId}
   * @returns {Promise<Object|null>}
   * @private
   */
  async _getNextPlayableFromChild(child, resolved) {
    const { adapter } = resolved;

    // Get all playables from the child source
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

    // For single items (e.g., a single hymn), return it directly
    if (items.length === 1) return items[0];

    // Determine storage path for watch state lookup
    const storagePath = adapter.getStoragePath?.(child.id) || child.source || 'media';

    // If no mediaProgressMemory, return first item
    if (!this.mediaProgressMemory) {
      return items[0];
    }

    // First pass: find any in-progress item
    for (const item of items) {
      const mediaKey = item.localId || item.id.split(':')[1];
      const state = await this.mediaProgressMemory.get(mediaKey, storagePath);
      const percent = state?.percent || 0;

      // In progress if between 1% and 90%
      if (percent > 1 && percent < 90) {
        return item;
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const mediaKey = item.localId || item.id.split(':')[1];
      const state = await this.mediaProgressMemory.get(mediaKey, storagePath);
      const percent = state?.percent || 0;

      // Unwatched if < 90%
      if (percent < 90) {
        return item;
      }
    }

    // All watched - return null or first item as fallback
    return items[0];
  }
}

export default FolderAdapter;
