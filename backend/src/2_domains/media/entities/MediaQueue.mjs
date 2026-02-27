import crypto from 'crypto';
import { QueueFullError } from '#domains/media/errors.mjs';

const MAX_QUEUE_SIZE = 500;

/**
 * Enum for how an item was added to the queue.
 * Pass-through metadata — no business logic depends on it.
 */
export const ADDED_FROM = Object.freeze({
  SEARCH: 'SEARCH',
  URL: 'URL',
  CAST: 'CAST',
  WEBSOCKET: 'WEBSOCKET',
});

/**
 * MediaQueue Entity — the core domain model for a playback queue.
 *
 * Mutable fields, toJSON/fromJSON serialization, no I/O dependencies.
 */
export class MediaQueue {
  constructor({
    position = 0,
    shuffle = false,
    repeat = 'off',
    volume = 1.0,
    items = [],
    shuffleOrder = [],
  } = {}) {
    this.position = position;
    this.shuffle = shuffle;
    this.repeat = repeat;
    this.volume = volume;
    this.items = items;
    this.shuffleOrder = shuffleOrder;
  }

  // ---- Static factories ----

  static empty() {
    return new MediaQueue();
  }

  static fromJSON(data) {
    return new MediaQueue({
      position: data.position,
      shuffle: data.shuffle,
      repeat: data.repeat,
      volume: data.volume,
      items: data.items ? [...data.items] : [],
      shuffleOrder: data.shuffleOrder ? [...data.shuffleOrder] : [],
    });
  }

  // ---- Serialization ----

  toJSON() {
    return {
      position: this.position,
      shuffle: this.shuffle,
      repeat: this.repeat,
      volume: this.volume,
      items: this.items.map((item) => ({ ...item })),
      shuffleOrder: [...this.shuffleOrder],
    };
  }

  // ---- Accessors ----

  get currentItem() {
    if (this.items.length === 0) return null;

    const idx = this.shuffle && this.shuffleOrder.length > 0
      ? this.shuffleOrder[this.position]
      : this.position;

    if (idx == null || idx < 0 || idx >= this.items.length) return null;
    return this.items[idx];
  }

  get isEmpty() {
    return this.items.length === 0;
  }

  get length() {
    return this.items.length;
  }

  findByQueueId(queueId) {
    return this.items.find((item) => item.queueId === queueId) ?? null;
  }

  // ---- Mutations ----

  /**
   * Add items to the queue.
   * @param {Array<Object>} newItems - Items to add (each gets a queueId stamped).
   * @param {'end'|'next'} placement - Where to insert: 'end' appends, 'next' inserts after current.
   * @returns {Array<Object>} The stamped items that were added.
   * @throws {QueueFullError} If adding would exceed MAX_QUEUE_SIZE.
   */
  addItems(newItems, placement = 'end') {
    if (this.items.length + newItems.length > MAX_QUEUE_SIZE) {
      throw new QueueFullError(this.items.length, MAX_QUEUE_SIZE);
    }

    const stamped = newItems.map((item) => ({
      ...item,
      queueId: crypto.randomBytes(4).toString('hex'),
    }));

    if (placement === 'next') {
      const insertAt = this.position + 1;
      this.items.splice(insertAt, 0, ...stamped);
    } else {
      this.items.push(...stamped);
    }

    return stamped;
  }

  /**
   * Remove an item by its queueId.
   * Adjusts position to keep the current item stable.
   */
  removeByQueueId(queueId) {
    const idx = this.items.findIndex((item) => item.queueId === queueId);
    if (idx === -1) return;

    this.items.splice(idx, 1);

    if (idx < this.position) {
      // Removed before current — shift position back to keep same item.
      this.position--;
    }

    // Clamp position to valid range.
    if (this.items.length > 0 && this.position >= this.items.length) {
      this.position = this.items.length - 1;
    }
  }

  /**
   * Move an item to a new index. Adjusts position to keep the current item stable.
   */
  reorder(queueId, toIndex) {
    const fromIndex = this.items.findIndex((item) => item.queueId === queueId);
    if (fromIndex === -1) return;

    // Remember which item is currently playing.
    const currentQueueId = this.items[this.position]?.queueId;

    // Remove from old position and insert at new.
    const [item] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, item);

    // Restore position to wherever the current item ended up.
    if (currentQueueId != null) {
      this.position = this.items.findIndex((i) => i.queueId === currentQueueId);
    }
  }

  /**
   * Advance playback position.
   * @param {number} step - Number of positions to move (positive = forward, negative = backward).
   * @param {Object} options
   * @param {boolean} options.auto - True if this advance was triggered automatically (track ended).
   */
  advance(step = 1, { auto = false } = {}) {
    const len = this.shuffle && this.shuffleOrder.length > 0
      ? this.shuffleOrder.length
      : this.items.length;

    if (len === 0) return;

    // repeat-one + auto: stay in place
    if (this.repeat === 'one' && auto) {
      return;
    }

    const next = this.position + step;

    if (this.repeat === 'all' && auto) {
      // Wrap around in both directions.
      this.position = ((next % len) + len) % len;
      return;
    }

    // For manual advance (and repeat-off auto), clamp to [0, len].
    // position === len means "past end" (currentItem returns null).
    if (next < 0) {
      this.position = 0;
    } else {
      this.position = next; // allow going to len (past-end sentinel)
    }
  }

  /**
   * Clear the entire queue.
   */
  clear() {
    this.items = [];
    this.shuffleOrder = [];
    this.position = 0;
  }

  /**
   * Enable or disable shuffle mode.
   * Enabling: Fisher-Yates shuffle with the current item pinned at shuffleOrder[0], position resets to 0.
   * Disabling: restores the original index from shuffleOrder[position], clears shuffleOrder.
   */
  setShuffle(enabled) {
    if (enabled) {
      this.shuffle = true;

      // Build an array of indices and Fisher-Yates shuffle it.
      const indices = Array.from({ length: this.items.length }, (_, i) => i);

      // Determine the real item index of the currently playing item.
      const currentOriginalIndex = this.shuffle && this.shuffleOrder.length > 0
        ? this.shuffleOrder[this.position]
        : this.position;

      // Fisher-Yates shuffle.
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Pin the current item at index 0 of the shuffle order.
      const currentPosInShuffle = indices.indexOf(currentOriginalIndex);
      if (currentPosInShuffle !== 0) {
        [indices[0], indices[currentPosInShuffle]] = [indices[currentPosInShuffle], indices[0]];
      }

      this.shuffleOrder = indices;
      this.position = 0;
    } else {
      // Restore original index from current shuffle position.
      const originalIndex = this.shuffleOrder[this.position] ?? this.position;
      this.shuffle = false;
      this.shuffleOrder = [];
      this.position = originalIndex;
    }
  }
}

export default MediaQueue;
