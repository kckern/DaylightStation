// backend/src/domains/content/entities/WatchState.mjs

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {Object} WatchStateProps
 * @property {string} itemId - Compound ID of the item
 * @property {number} playhead - Current position in seconds
 * @property {number} duration - Total duration in seconds
 * @property {number} [playCount=0] - Number of times started
 * @property {string} [lastPlayed] - ISO timestamp of last play
 * @property {number} [watchTime=0] - Total seconds spent watching
 */

/**
 * Watch state tracks playback progress for an item.
 */
export class WatchState {
  /**
   * @param {WatchStateProps} props
   */
  constructor(props) {
    if (!props.itemId) throw new ValidationError('WatchState requires itemId', { code: 'MISSING_ITEM_ID', field: 'itemId' });

    this.itemId = props.itemId;
    this.playhead = props.playhead ?? 0;
    this.duration = props.duration ?? 0;
    this.playCount = props.playCount ?? 0;
    this.lastPlayed = props.lastPlayed ?? null;
    this.watchTime = props.watchTime ?? 0;
  }

  /**
   * Calculate percentage watched (0-100)
   * @returns {number}
   */
  get percent() {
    if (!this.duration) return 0;
    return Math.round((this.playhead / this.duration) * 100);
  }

  /**
   * Check if item is considered fully watched (>= 90%)
   * @returns {boolean}
   */
  isWatched() {
    return this.percent >= 90;
  }

  /**
   * Check if item is in progress (started but not finished)
   * @returns {boolean}
   */
  isInProgress() {
    return this.playhead > 0 && !this.isWatched();
  }

  /**
   * Convert to plain object for persistence
   * @returns {Object}
   */
  toJSON() {
    return {
      itemId: this.itemId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
  }

  /**
   * Create WatchState from persisted data
   * @param {Object} data
   * @returns {WatchState}
   */
  static fromJSON(data) {
    return new WatchState(data);
  }
}
