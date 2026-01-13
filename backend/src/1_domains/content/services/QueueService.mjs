// backend/src/domains/content/services/QueueService.mjs
import { PlayableItem } from '../capabilities/Playable.mjs';

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
 * Number of days before skip_after to mark as urgent
 */
const URGENCY_DAYS = 8;

/**
 * Number of days to look ahead for wait_until filtering
 */
const WAIT_LOOKAHEAD_DAYS = 2;

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
   * Filter items that are past their skip_after deadline.
   * Items without skip_after are always included.
   *
   * @param {Array} items - Items with optional skip_after field
   * @param {Date} [now] - Current date for testing
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterBySkipAfter(items, now = new Date()) {
    return items.filter(item => {
      if (!item.skip_after) return true;
      const deadline = new Date(item.skip_after);
      return deadline >= now;
    });
  }

  /**
   * Mark items as urgent if skip_after is within URGENCY_DAYS.
   * Does not upgrade in_progress items (they already have top priority).
   *
   * @param {Array} items - Items with optional skip_after and priority fields
   * @param {Date} [now] - Current date for testing
   * @returns {Array} Items with updated priority (new array, original unchanged)
   */
  static applyUrgency(items, now = new Date()) {
    const urgencyThreshold = new Date(now);
    urgencyThreshold.setDate(urgencyThreshold.getDate() + URGENCY_DAYS);

    return items.map(item => {
      if (!item.skip_after) return item;
      const deadline = new Date(item.skip_after);
      if (deadline <= urgencyThreshold && item.priority !== 'in_progress') {
        return { ...item, priority: 'urgent' };
      }
      return item;
    });
  }

  /**
   * Filter items that have wait_until more than WAIT_LOOKAHEAD_DAYS in future.
   * Items without wait_until are always included.
   * Items with wait_until in the past or within lookahead window are included.
   *
   * @param {Array} items - Items with optional wait_until field
   * @param {Date} [now] - Current date for testing
   * @returns {Array} Filtered items (new array, original unchanged)
   */
  static filterByWaitUntil(items, now = new Date()) {
    const lookaheadDate = new Date(now);
    lookaheadDate.setDate(lookaheadDate.getDate() + WAIT_LOOKAHEAD_DAYS);

    return items.filter(item => {
      if (!item.wait_until) return true;
      const waitDate = new Date(item.wait_until);
      return waitDate <= lookaheadDate;
    });
  }

  /**
   * @param {Object} config
   * @param {import('../ports/IWatchStateStore.mjs').IWatchStateStore} config.watchStore
   */
  constructor(config) {
    this.watchStore = config.watchStore;
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
      const state = await this.watchStore.get(item.id, storagePath);
      if (state?.isInProgress()) {
        return this._withResumePosition(item, state);
      }
    }

    // Second pass: find first unwatched item
    for (const item of items) {
      const state = await this.watchStore.get(item.id, storagePath);
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
