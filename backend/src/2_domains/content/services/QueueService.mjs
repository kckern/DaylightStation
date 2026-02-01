// backend/src/domains/content/services/QueueService.mjs
import { PlayableItem } from '../capabilities/Playable.mjs';

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
   * @param {Object} config
   * @param {Object} config.mediaProgressMemory - IMediaProgressMemory instance for watch state
   */
  constructor(config) {
    this.mediaProgressMemory = config.mediaProgressMemory;
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
