// backend/src/2_adapters/content/folder/FolderAdapter.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ListableItem } from '../../../1_domains/content/capabilities/Listable.mjs';
import { Item } from '../../../1_domains/content/entities/Item.mjs';

// Threshold for considering an item "watched" (90%)
const WATCHED_THRESHOLD = 90;
// Minimum progress to count as "in progress"
const MIN_PROGRESS_THRESHOLD = 1;

/**
 * Adapter for custom folders/watchlists containing mixed-source items
 * Supports watch state integration for priority-based ordering
 */
export class FolderAdapter {
  constructor(config) {
    if (!config.watchlistPath) throw new Error('FolderAdapter requires watchlistPath');
    this.watchlistPath = config.watchlistPath;
    this.registry = config.registry || null;
    this.historyPath = config.historyPath || null; // Path to media_memory directory
    this._watchlistCache = null;
    this._watchStateCache = {};
  }

  get source() {
    return 'folder';
  }

  get prefixes() {
    return [{ prefix: 'folder' }];
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
      if (!fs.existsSync(this.watchlistPath)) return [];
      const content = fs.readFileSync(this.watchlistPath, 'utf8');
      this._watchlistCache = yaml.load(content) || [];
      return this._watchlistCache;
    } catch (err) {
      return [];
    }
  }

  /**
   * Load watch state for a given source category
   * @param {string} category - Category like 'plex', 'talks', 'media'
   * @returns {Object} Watch state map { mediaKey: { percent, seconds, playhead, mediaDuration } }
   */
  _loadWatchState(category) {
    if (!this.historyPath) return {};
    if (this._watchStateCache[category]) return this._watchStateCache[category];

    try {
      // Handle plex library-specific files
      if (category === 'plex') {
        return this._loadPlexWatchState();
      }

      const filePath = path.join(this.historyPath, `${category}.yml`);
      if (!fs.existsSync(filePath)) return {};
      const content = fs.readFileSync(filePath, 'utf8');
      this._watchStateCache[category] = yaml.load(content) || {};
      return this._watchStateCache[category];
    } catch (err) {
      return {};
    }
  }

  /**
   * Load watch state from all Plex library files
   * @returns {Object} Combined watch state from all Plex libraries
   */
  _loadPlexWatchState() {
    if (this._watchStateCache.plex) return this._watchStateCache.plex;

    const combined = {};
    const plexDir = path.join(this.historyPath, 'plex');

    try {
      if (!fs.existsSync(plexDir)) return {};
      const files = fs.readdirSync(plexDir);

      for (const file of files) {
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
        const filePath = path.join(plexDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const data = yaml.load(content) || {};
        Object.assign(combined, data);
      }

      this._watchStateCache.plex = combined;
      return combined;
    } catch (err) {
      return {};
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

    // Check for urgent based on skip_after deadline
    if (item.skip_after) {
      const skipDate = new Date(item.skip_after);
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
   * Check if item should be skipped based on scheduling rules
   * @param {Object} item - Watchlist item with scheduling fields
   * @param {Object} watchState - Watch state for this item
   * @param {Object} options - { ignoreSkips, ignoreWatchStatus, ignoreWait }
   * @returns {boolean} True if item should be skipped
   */
  _shouldSkipItem(item, watchState, options = {}) {
    const { ignoreSkips = false, ignoreWatchStatus = false, ignoreWait = false } = options;

    // Skip if on hold
    if (item.hold) return true;

    // Skip if watched (>90%)
    if (!ignoreWatchStatus && this._isWatched(watchState)) return true;

    // Skip if marked as watched in watchlist
    if (!ignoreWatchStatus && item.watched) return true;

    // Skip if past skip_after date
    if (!ignoreSkips && item.skip_after) {
      const skipDate = new Date(item.skip_after);
      if (skipDate < new Date()) return true;
    }

    // Skip if wait_until is more than 2 days away
    if (!ignoreWait && item.wait_until) {
      const waitDate = new Date(item.wait_until);
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
   * @param {string} id - Folder ID (folder:FolderName)
   * @param {Object} options - { ignoreSkips, ignoreWatchStatus, ignoreWait }
   * @returns {Promise<ListableItem|null>}
   */
  async getList(id, options = {}) {
    const folderName = id.replace('folder:', '');
    const watchlist = this._loadWatchlist();

    // Filter items belonging to this folder
    const folderItems = watchlist.filter(item => item.folder === folderName);
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
    const skippedItems = [];

    for (const item of folderItems) {
      const parsed = this._parseInput(item.input);
      if (!parsed) continue;

      const mapping = sourceMap[parsed.source] || { source: parsed.source, category: parsed.source };
      const contentSource = mapping.source;
      const watchCategory = mapping.category;

      // Build the media key for watch state lookup
      const mediaKey = item.media_key || parsed.id;

      // Load watch state for this item's category
      const watchState = watchCategory ? this._loadWatchState(watchCategory)[mediaKey] : null;

      // Check if item should be skipped
      if (this._shouldSkipItem(item, watchState, options)) {
        skippedItems.push(item);
        continue;
      }

      // Calculate priority based on watch state and scheduling
      const priority = this._calculatePriority(item, watchState);

      // Extract watch progress
      const percent = watchState?.percent || 0;
      const seconds = watchState?.seconds || watchState?.playhead || 0;

      const compoundId = contentSource === 'folder'
        ? parsed.id
        : `${contentSource}:${parsed.id}`;

      children.push(new Item({
        id: compoundId,
        source: contentSource,
        title: item.label || parsed.id,
        type: item.action === 'Queue' ? 'queue' : 'list',
        thumbnail: item.image,
        metadata: {
          // Watch state
          percent,
          seconds,
          priority,
          // Scheduling fields
          hold: item.hold || false,
          skip_after: item.skip_after || null,
          wait_until: item.wait_until || null,
          // Grouping
          program: item.program || folderName,
          // Legacy fields
          shuffle: item.shuffle,
          continuous: item.continuous,
          playable: item.playable,
          uid: item.uid,
          // Original source for reference
          src: item.src || parsed.source,
          media_key: mediaKey
        }
      }));
    }

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

    // If no items remain after filtering, try with relaxed filters (legacy behavior)
    if (children.length === 0 && skippedItems.length > 0) {
      if (!options.ignoreSkips) {
        return this.getList(id, { ...options, ignoreSkips: true });
      }
      if (!options.ignoreWatchStatus) {
        return this.getList(id, { ...options, ignoreSkips: true, ignoreWatchStatus: true });
      }
      if (!options.ignoreWait) {
        return this.getList(id, { ...options, ignoreSkips: true, ignoreWatchStatus: true, ignoreWait: true });
      }
    }

    return new ListableItem({
      id,
      source: 'folder',
      title: folderName,
      itemType: 'container',
      children
    });
  }

  async getItem(id) {
    const list = await this.getList(id);
    if (!list) return null;
    return new ListableItem({
      id,
      source: 'folder',
      title: list.title,
      itemType: 'container',
      childCount: list.children.length
    });
  }

  async resolvePlayables(id) {
    const list = await this.getList(id);
    if (!list || !this.registry) return [];
    const playables = [];
    for (const child of list.children) {
      const resolved = this.registry.resolve(child.id);
      if (resolved?.adapter?.resolvePlayables) {
        const childPlayables = await resolved.adapter.resolvePlayables(child.id);
        playables.push(...childPlayables);
      }
    }
    return playables;
  }
}
