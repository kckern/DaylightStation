// backend/src/domains/content/entities/MediaProgress.mjs

import { ValidationError } from '../../core/errors/index.mjs';

/**
 * @typedef {Object} MediaProgressProps
 * @property {string} contentId - Compound ID of the item
 * @property {number} playhead - Current position in seconds
 * @property {number} duration - Total duration in seconds
 * @property {number} [playCount=0] - Number of times started
 * @property {string} [lastPlayed] - ISO timestamp of last play
 * @property {number} [watchTime=0] - Total seconds spent watching
 * @property {string|null} [completedAt] - Timestamp of first completion (never cleared once set)
 * @property {Object} [bookmark] - Position recovery bookmark (auto-expires after 7 days)
 * @property {number} [now] - Current time in ms (for bookmark expiry check; avoids impure Date.now())
 */

/**
 * Media progress tracks playback progress for an item.
 */
export class MediaProgress {
  /**
   * @param {MediaProgressProps} props
   */
  constructor(props) {
    if (!props.contentId) throw new ValidationError('MediaProgress requires contentId', { code: 'MISSING_CONTENT_ID', field: 'contentId' });

    this.contentId = props.contentId;
    this.playhead = props.playhead ?? 0;
    this.duration = props.duration ?? 0;
    this.playCount = props.playCount ?? 0;
    this.lastPlayed = props.lastPlayed ?? null;
    this.watchTime = props.watchTime ?? 0;
    this.completedAt = props.completedAt ?? null;
    this._storedPercent = props.percent ?? null;

    // Bookmark for position recovery (optional, expires after 7 days)
    const rawBookmark = props.bookmark ?? null;
    if (rawBookmark && rawBookmark.createdAt) {
      const now = props.now ?? Date.now();
      const age = now - Date.parse(rawBookmark.createdAt);
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
   * Serialize to a plain object using canonical field names.
   * Excludes legacy field aliases (seconds, mediaDuration, time).
   * Conditionally includes completedAt and bookmark when present (truthy check —
   * null/undefined are omitted to match the canonical persisted shape).
   * @returns {Object}
   */
  toJSON() {
    const json = {
      contentId: this.contentId,
      playhead: this.playhead,
      duration: this.duration,
      percent: this.percent,
      playCount: this.playCount,
      lastPlayed: this.lastPlayed,
      watchTime: this.watchTime
    };
    if (this.completedAt) json.completedAt = this.completedAt;
    if (this.bookmark) json.bookmark = this.bookmark;
    return json;
  }

}

export default MediaProgress;
