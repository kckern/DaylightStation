// backend/src/domains/content/entities/MediaProgress.mjs

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {Object} MediaProgressProps
 * @property {string} itemId - Compound ID of the item
 * @property {number} playhead - Current position in seconds
 * @property {number} duration - Total duration in seconds
 * @property {number} [playCount=0] - Number of times started
 * @property {string} [lastPlayed] - ISO timestamp of last play
 * @property {number} [watchTime=0] - Total seconds spent watching
 * @property {Object} [bookmark] - Position recovery bookmark (auto-expires after 7 days)
 */

/**
 * Media progress tracks playback progress for an item.
 */
export class MediaProgress {
  /**
   * @param {MediaProgressProps} props
   */
  constructor(props) {
    if (!props.itemId) throw new ValidationError('MediaProgress requires itemId', { code: 'MISSING_ITEM_ID', field: 'itemId' });

    this.itemId = props.itemId;
    this.playhead = props.playhead ?? 0;
    this.duration = props.duration ?? 0;
    this.playCount = props.playCount ?? 0;
    this.lastPlayed = props.lastPlayed ?? null;
    this.watchTime = props.watchTime ?? 0;
    this._storedPercent = props.percent ?? null;

    // Bookmark for position recovery (optional, expires after 7 days)
    const rawBookmark = props.bookmark ?? null;
    if (rawBookmark && rawBookmark.createdAt) {
      const age = Date.now() - Date.parse(rawBookmark.createdAt);
      this.bookmark = age <= 7 * 24 * 60 * 60 * 1000 ? rawBookmark : null;
    } else {
      this.bookmark = rawBookmark;
    }
  }

  /**
   * Calculate percentage watched (0-100).
   * Uses stored percent as fallback when duration is missing.
   * @returns {number}
   */
  get percent() {
    if (this.duration) return Math.round((this.playhead / this.duration) * 100);
    if (this._storedPercent != null) return this._storedPercent;
    return 0;
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
   * Serialize to plain object
   * @returns {Object}
   */
  toJSON() {
    const json = {
      itemId: this.itemId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
    if (this.bookmark) json.bookmark = this.bookmark;
    return json;
  }
}

export default MediaProgress;
