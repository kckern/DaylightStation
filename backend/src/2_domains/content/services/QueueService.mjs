// backend/src/2_domains/content/services/QueueService.mjs
import { PlayableItem } from '../capabilities/Playable.mjs';
import { DefaultMediaProgressClassifier } from './DefaultMediaProgressClassifier.mjs';

/**
 * Day-of-week presets mapping strings to ISO weekday numbers.
 * ISO: 1=Monday, 7=Sunday
 */
const DAY_PRESETS = {
  'Weekdays': [1, 2, 3, 4, 5],
  'Weekend': [6, 7],
  'M•W•F': [1, 3, 5],
  'T•Th': [2, 4],
  'M•W': [1, 3]
};

/**
 * Priority ordering for queue items.
 * Lower numbers = higher priority.
 */
const PRIORITY_ORDER = {
  'in_progress': 0,
  'urgent': 1,
  'high': 2,
  'medium': 3,
  'low': 4
};

/**
 * Number of days before skipAfter to mark as urgent
 */
const URGENCY_DAYS = 8;

/**
 * Number of days to look ahead for waitUntil filtering
 */
const WAIT_LOOKAHEAD_DAYS = 2;

/**
 * Threshold percentage for considering an item as watched
 */
const WATCHED_THRESHOLD = 90;

/**
 * QueueService handles play vs queue logic with watch state awareness.
 *
 * Key distinction:
 * - getNextPlayable() → SINGLE item (respects watch state, for daily programming)
 * - getAllPlayables() → ALL items (for queue/binge watching)
 */
export class QueueService {
  /**
   * Sort items by priority.
   * Order: in_progress (by percent desc) > urgent > high > medium > low
   * Items without priority are treated as medium.
   * Stable sort preserves original order for items with same priority.
   *
   * @param {Array} items - Items with optional priority and percent fields
   * @returns {Array} Sorted items (new array, original unchanged)
   */
  static sortByPriority(items) {
    // Use index to ensure stable sort
    const indexed = items.map((item, index) => ({ item, index }));

    indexed.sort((a, b) => {
      const priorityA = PRIORITY_ORDER[a.item.priority] ?? PRIORITY_ORDER.medium;
      const priorityB = PRIORITY_ORDER[b.item.priority] ?? PRIORITY_ORDER.medium;

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      // For in_progress items, sort by percent descending
      if (a.item.priority === 'in_progress' && b.item.priority === 'in_progress') {
        const percentA = a.item.percent || 0;
        const percentB = b.item.percent || 0;
        if (percentA !== percentB) {
          return percentB - percentA;
        }
      }

      // Preserve original order (stable sort)
      return a.index - b.index;
    });

    return indexed.map(({ item }) => item);
  }

  /**
   * Filter items that are past their skipAfter deadline.
   * Items without skipAfter are always included.
   *
   * @param {Array} items - Items with optional skipAfter field
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterBySkipAfter(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for filterBySkipAfter');
    }
    return items.filter(item => {
      if (!item.skipAfter) return true;
      const deadline = new Date(item.skipAfter);
      return deadline >= now;
    });
  }

  /**
   * Mark items as urgent if skipAfter is within URGENCY_DAYS.
   * Does not upgrade in_progress items (they already have top priority).
   *
   * @param {Array} items - Items with optional skipAfter and priority fields
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Items with updated priority (new array, original unchanged)
   */
  static applyUrgency(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for applyUrgency');
    }
    const urgencyThreshold = new Date(now);
    urgencyThreshold.setDate(urgencyThreshold.getDate() + URGENCY_DAYS);

    return items.map(item => {
      if (!item.skipAfter) return item;
      const deadline = new Date(item.skipAfter);
      if (deadline <= urgencyThreshold && item.priority !== 'in_progress') {
        return { ...item, priority: 'urgent' };
      }
      return item;
    });
  }

  /**
   * Filter items that have waitUntil more than WAIT_LOOKAHEAD_DAYS in future.
   * Items without waitUntil are always included.
   * Items with waitUntil in the past or within lookahead window are included.
   *
   * @param {Array} items - Items with optional waitUntil field
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByWaitUntil(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for filterByWaitUntil');
    }
    const lookaheadDate = new Date(now);
    lookaheadDate.setDate(lookaheadDate.getDate() + WAIT_LOOKAHEAD_DAYS);

    return items.filter(item => {
      if (!item.waitUntil) return true;
      const waitDate = new Date(item.waitUntil);
      return waitDate <= lookaheadDate;
    });
  }

  /**
   * Filter out items that are on hold.
   * Items without a hold field are included.
   *
   * @param {Array} items - Items with optional hold field
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByHold(items) {
    return items.filter(item => !item.hold);
  }

  /**
   * Filter out items that are watched (>= 90% or explicitly marked).
   * Items without percent or watched fields are included.
   *
   * @param {Array} items - Items with optional watched and percent fields
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByWatched(items) {
    return items.filter(item => {
      if (item.watched) return false;
      if ((item.percent || 0) >= WATCHED_THRESHOLD) return false;
      return true;
    });
  }

  /**
   * Filter items by day of week.
   * Items can have a `days` property that's either:
   * - An array of ISO weekday numbers [1-7] where 1=Monday, 7=Sunday
   * - A preset string like "Weekdays", "Weekend", "M•W•F"
   * Items without days field are always included.
   *
   * @param {Array} items - Items with optional days field
   * @param {Date} now - Current date (required, from application layer)
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByDayOfWeek(items, now) {
    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for filterByDayOfWeek');
    }
    // ISO weekday: 1=Monday, 7=Sunday
    // JS getDay(): 0=Sunday, 1=Monday, etc.
    const jsDay = now.getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay; // Convert Sunday from 0 to 7

    return items.filter(item => {
      if (!item.days) return true;

      let allowedDays = item.days;
      if (typeof allowedDays === 'string') {
        allowedDays = DAY_PRESETS[allowedDays] || [];
      }

      return allowedDays.includes(dayOfWeek);
    });
  }

  /**
   * Apply all filters to items
   * @param {Array} items
   * @param {Object} options
   * @param {boolean} [options.ignoreSkips=false]
   * @param {boolean} [options.ignoreWatchStatus=false]
   * @param {boolean} [options.ignoreWait=false]
   * @param {boolean} [options.allowFallback=false]
   * @param {Date} options.now - Current date (required, from application layer)
   * @returns {Array}
   */
  static applyFilters(items, options = {}) {
    const { ignoreSkips, ignoreWatchStatus, ignoreWait, allowFallback, now } = options;

    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for applyFilters');
    }

    let result = [...items];

    // Apply filters based on ignore flags
    if (!ignoreSkips) {
      result = this.filterByHold(result);
      result = this.filterBySkipAfter(result, now);
    }

    if (!ignoreWatchStatus) {
      result = this.filterByWatched(result);
    }

    if (!ignoreWait) {
      result = this.filterByWaitUntil(result, now);
    }

    result = this.filterByDayOfWeek(result, now);

    // Fallback cascade if empty
    if (result.length === 0 && allowFallback) {
      if (!ignoreSkips) {
        return this.applyFilters(items, { ...options, ignoreSkips: true });
      }
      if (!ignoreWatchStatus) {
        return this.applyFilters(items, { ...options, ignoreSkips: true, ignoreWatchStatus: true });
      }
      if (!ignoreWait) {
        return this.applyFilters(items, { ...options, ignoreSkips: true, ignoreWatchStatus: true, ignoreWait: true });
      }
    }

    return result;
  }

  /**
   * Build a prioritized, filtered queue from items
   * @param {Array} items
   * @param {Object} options
   * @param {Date} options.now - Current date (required, from application layer)
   * @returns {Array}
   */
  static buildQueue(items, options = {}) {
    const { now } = options;

    if (!now || !(now instanceof Date)) {
      throw new Error('now date required for buildQueue');
    }

    // Apply urgency based on deadlines
    let result = this.applyUrgency(items, now);

    // Apply filters with fallback
    result = this.applyFilters(result, { ...options, allowFallback: true });

    // Sort by priority
    result = this.sortByPriority(result);

    return result;
  }

  /**
   * Shuffle an array in place using Fisher-Yates.
   * @param {Array} items
   * @returns {Array} The same array, shuffled
   */
  static shuffleArray(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /**
   * Partition items into unwatched and watched groups using a classifier.
   * @param {Array} items - Playable items with .id property
   * @param {Map<string, Object>} progressMap - Map of itemId -> MediaProgress-like object
   * @param {Object} classifier - Object with classify(progress, contentMeta) method
   * @returns {{ unwatched: Array, watched: Array }}
   */
  static partitionByWatchStatus(items, progressMap, classifier) {
    const unwatched = [];
    const watched = [];

    for (const item of items) {
      const progress = progressMap.get(item.id);
      const status = progress
        ? classifier.classify(progress, { duration: item.duration })
        : 'unwatched';

      if (status === 'watched') {
        watched.push(item);
      } else {
        unwatched.push(item);
      }
    }

    return { unwatched, watched };
  }

  /**
   * @param {Object} config
   * @param {Object} config.mediaProgressMemory - IMediaProgressMemory instance for watch state
   * @param {Object} [config.classifier] - IMediaProgressClassifier instance (defaults to DefaultMediaProgressClassifier)
   */
  constructor(config) {
    this.mediaProgressMemory = config.mediaProgressMemory;
    this.classifier = config.classifier || new DefaultMediaProgressClassifier();
  }

  /**
   * Get the next playable item based on watch state.
   * Priority: in-progress > unwatched > null (all watched)
   *
   * @param {PlayableItem[]} items
   * @param {string} storagePath - Storage path for watch state
   * @returns {Promise<PlayableItem|null>}
   */
  async getNextPlayable(items, storagePath) {
    if (!items.length) return null;

    // First pass: find any in-progress items
    for (const item of items) {
      const state = await this.mediaProgressMemory.get(item.id, storagePath);
      if (state?.isInProgress()) {
        return this._withResumePosition(item, state);
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const state = await this.mediaProgressMemory.get(item.id, storagePath);
      if (!state || !state.isWatched()) {
        return item;
      }
    }

    // All items watched
    return null;
  }

  /**
   * Get all playable items in order (for queue loading).
   *
   * @param {PlayableItem[]} items
   * @returns {Promise<PlayableItem[]>}
   */
  async getAllPlayables(items) {
    return items;
  }

  /**
   * Resolve a queue: enrich with media memory, partition by watch status, optionally shuffle.
   *
   * @param {PlayableItem[]} playables - Raw playable items from adapter
   * @param {string} source - Source identifier (e.g. 'plex') for loading media memory
   * @param {Object} [options]
   * @param {boolean} [options.shuffle=false] - Shuffle within each partition
   * @returns {Promise<PlayableItem[]>} Ordered items: unwatched/in-progress first, watched last
   */
  async resolveQueue(playables, source, { shuffle = false } = {}) {
    if (!this.mediaProgressMemory) {
      return shuffle ? QueueService.shuffleArray([...playables]) : playables;
    }

    // Collect unique sources from items — a "list" or "menu" queue contains
    // items from various actual sources (e.g., plex). Progress is stored under
    // the item's source, not the parent container's source.
    const itemSources = new Set(playables.map(p => p.source).filter(Boolean));
    if (!itemSources.size) itemSources.add(source);

    const progressMap = new Map();
    for (const src of itemSources) {
      const progress = await this.mediaProgressMemory.getAllFromAllLibraries(src);
      for (const p of progress) {
        progressMap.set(p.itemId, p);
      }
    }

    // Enrich items with resume positions from media memory
    const enriched = playables.map(item => {
      const progress = progressMap.get(item.id);
      if (progress && item.resumable && progress.playhead) {
        return this._withResumePosition(item, progress);
      }
      return item;
    });

    // Partition by watch status: unwatched/in-progress first, watched last
    const { unwatched, watched } = QueueService.partitionByWatchStatus(
      enriched, progressMap, this.classifier
    );

    return [
      ...(shuffle ? QueueService.shuffleArray([...unwatched]) : unwatched),
      ...(shuffle ? QueueService.shuffleArray([...watched]) : watched)
    ];
  }

  /**
   * Apply resume position to a playable item
   * @private
   */
  _withResumePosition(item, state) {
    // Create a new PlayableItem with the resume position
    return new PlayableItem({
      id: item.id,
      source: item.source,
      localId: item.localId,
      title: item.title,
      mediaType: item.mediaType,
      mediaUrl: item.mediaUrl,
      duration: item.duration,
      resumable: item.resumable,
      resumePosition: state.playhead,
      playbackRate: item.playbackRate,
      thumbnail: item.thumbnail,
      description: item.description,
      metadata: item.metadata
    });
  }
}

export default QueueService;
