// backend/src/domains/content/services/QueueService.mjs
import { PlayableItem } from '../capabilities/Playable.mjs';

/**
 * QueueService handles play vs queue logic with watch state awareness.
 *
 * Key distinction:
 * - getNextPlayable() → SINGLE item (respects watch state, for daily programming)
 * - getAllPlayables() → ALL items (for queue/binge watching)
 */
export class QueueService {
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
