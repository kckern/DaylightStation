// __backend/src/1_domains/fitness/services/FitnessProgressClassifier.mjs

import { MediaProgressClassificationStrategy } from "../../../../../../__capabilities/playback/server/domain/services/MediaProgressClassificationStrategy.mjs";
import { isWatchComplete } from "#shared/contracts/media/watchCompletion.mjs";

/**
 * Fitness-specific media progress classifier
 *
 * Implements different thresholds than standard media because workout
 * viewing patterns differ from entertainment content:
 *
 * **Short workouts (≤45 min):** 50% threshold
 * - Users often skip warmups/cooldowns but complete the main workout
 * - Example: 30-min HIIT, user stops at 85% skipping cooldown = "watched"
 *
 * **Long workouts (>45 min):** 95% threshold AND at most 5 min left
 * - These are typically multi-session content (e.g., Mario Kart longplay
 *   where you do one cup per day)
 * - Need to preserve progress for resuming across days
 * - Example: 2-hour cycling video at 60% should stay "in_progress"
 * - A percentage alone scales with length: 5% of a 5-hour longplay is
 *   15 minutes, a whole cup. Example: 4h51m Sonic Racing stopped at 94%
 *   (17 min left) stays "in_progress"; so would 96% (12 min left)
 *
 * **Anti-seeking protection:** 30 seconds minimum
 * - Prevents accidental "watched" status from seeking/previewing
 * - Lower than standard (60s) because workout selection is intentional
 * - Example: User seeks to preview a workout segment, closes after 5s
 *   of actual playback = stays "in_progress" even if playhead is at 90%
 */
export class FitnessProgressClassifier extends MediaProgressClassificationStrategy {
  /**
   * @param {Object} config - Override default thresholds
   * @param {number} [config.shortThresholdPercent=50] - % to mark short content watched
   * @param {number} [config.longThresholdPercent=95] - % to mark long content watched
   * @param {number} [config.longDurationSeconds=2700] - Duration threshold (45 min)
   * @param {number} [config.longMaxRemainingSeconds=300] - Most that may be left of long content
   * @param {number} [config.minWatchTimeSeconds=30] - Anti-seeking minimum
   */
  constructor(config = {}) {
    super();
    this.config = {
      shortThresholdPercent: 50,
      longThresholdPercent: 95,
      longDurationSeconds: 45 * 60,  // 45 minutes
      longMaxRemainingSeconds: 5 * 60,
      minWatchTimeSeconds: 30,
      ...config
    };
  }

  /**
   * Classify workout viewing progress
   *
   * @param {import('#domains/content').MediaProgress} progress
   * @param {Object} [contentMeta]
   * @param {number} [contentMeta.duration] - Content duration in seconds
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   *
   * @example
   * // 30-min workout, user at 85% (skipped cooldown)
   * classifier.classify({ playhead: 1530, percent: 85, watchTime: 1500 }, { duration: 1800 })
   * // => 'watched' (85% >= 50% short threshold)
   *
   * @example
   * // 2-hour longplay, user at 60% across multiple sessions
   * classifier.classify({ playhead: 4320, percent: 60, watchTime: 4000 }, { duration: 7200 })
   * // => 'in_progress' (60% < 95% long threshold, preserves resume position)
   *
   * @example
   * // User previewed workout by seeking, only 10s actual playback
   * classifier.classify({ playhead: 1620, percent: 90, watchTime: 10 }, { duration: 1800 })
   * // => 'in_progress' (watchTime 10s < 30s anti-seeking threshold)
   */
  classify(progress, contentMeta = {}) {
    const { playhead, watchTime } = progress;
    const percent = progress.percent ?? 0;
    const duration = contentMeta.duration || progress.duration || 0;

    // No playhead = never started
    if (!playhead || playhead === 0) {
      return 'unwatched';
    }

    // Anti-seeking: must have actually watched content, not just seeked
    // Prevents false "watched" from preview/accidental seek
    if (watchTime !== undefined && watchTime < this.config.minWatchTimeSeconds) {
      return 'in_progress';
    }

    // Long content (>45 min) uses stricter threshold to preserve
    // resume position for multi-session viewing
    const isLongContent = duration > this.config.longDurationSeconds;
    if (!isLongContent) {
      return percent >= this.config.shortThresholdPercent ? 'watched' : 'in_progress';
    }

    // ...and the remaining time must be short too, or a long tail of real
    // content (the last cup of a longplay) is written off as credits
    return isWatchComplete(
      { percent, playhead, duration },
      { minPercent: this.config.longThresholdPercent, maxRemainingSec: this.config.longMaxRemainingSeconds }
    ) ? 'watched' : 'in_progress';
  }
}

export default FitnessProgressClassifier;
