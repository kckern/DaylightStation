// backend/src/domains/content/capabilities/Playable.mjs
import { Item } from '../entities/Item.mjs';

/**
 * @typedef {'audio' | 'video' | 'live' | 'composite'} MediaType
 */

/**
 * Playable capability - items that can be played/streamed.
 */
export class PlayableItem extends Item {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID: "source:localId"
   * @param {string} props.source - Adapter source name
   * @param {string} props.title - Display title
   * @param {MediaType} props.mediaType - Type of media content
   * @param {string} props.mediaUrl - Proxied URL for streaming
   * @param {number} [props.duration] - Duration in seconds
   * @param {boolean} props.resumable - Whether playback can be resumed
   * @param {number} [props.resumePosition] - Current position in seconds
   * @param {number} [props.playbackRate] - Playback speed multiplier
   * @param {string} [props.thumbnail] - Proxied thumbnail URL
   * @param {string} [props.description] - Item description
   * @param {Object} [props.metadata] - Additional metadata
   * @param {string} [props.lastPlayed] - ISO timestamp of last play
   * @param {number} [props.playCount] - Number of times played
   * @param {number} [props.watchProgress] - Explicit watch progress percentage (0-100)
   * @param {boolean} [props.shuffle] - Whether to shuffle playback (default: false)
   * @param {boolean} [props.continuous] - Whether to play continuously (default: false)
   * @param {boolean} [props.resume] - Whether to resume from last position (default: false)
   * @param {boolean} [props.active] - Whether item is active for queue filtering (default: true)
   */
  constructor(props) {
    super(props);
    this.mediaType = props.mediaType;
    this.mediaUrl = props.mediaUrl;
    this.duration = props.duration ?? null;
    this.resumable = props.resumable;
    this.resumePosition = props.resumePosition ?? null;
    this.playbackRate = props.playbackRate ?? 1.0;
    this.lastPlayed = props.lastPlayed ?? null;
    this.playCount = props.playCount ?? 0;
    this._watchProgress = props.watchProgress ?? null;
    // Behavior flags
    this.shuffle = props.shuffle || false;
    this.continuous = props.continuous || false;
    this.resume = props.resume || false;
    this.active = props.active !== false; // defaults to true
  }

  /**
   * Get watch progress percentage (0-100)
   * Returns explicit watchProgress if provided, otherwise calculates from resumePosition/duration
   * @returns {number|null}
   */
  get watchProgress() {
    if (this._watchProgress !== null) return this._watchProgress;
    if (this.resumePosition && this.duration) {
      return Math.round((this.resumePosition / this.duration) * 100);
    }
    return null;
  }

  /**
   * Alias for resumePosition (legacy compatibility)
   * @returns {number|null}
   */
  get watchSeconds() {
    return this.resumePosition;
  }

  /**
   * Get progress as percentage (0-100)
   * @returns {number|null}
   */
  getProgress() {
    if (!this.resumable || !this.duration || !this.resumePosition) {
      return null;
    }
    return Math.round((this.resumePosition / this.duration) * 100);
  }

  /**
   * Check if item is playable
   * @returns {boolean}
   */
  isPlayable() {
    return true;
  }
}
