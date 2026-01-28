// backend/src/1_domains/content/services/DefaultMediaProgressClassifier.mjs

import { IMediaProgressClassifier } from './IMediaProgressClassifier.mjs';

/**
 * Default implementation of media progress classification
 */
export class DefaultMediaProgressClassifier extends IMediaProgressClassifier {
  constructor(config = {}) {
    super();
    this.config = {
      watchedPercentThreshold: 90,
      minWatchTimeSeconds: 60,
      shortformDurationSeconds: 900,
      shortformPercentThreshold: 95,
      remainingSecondsThreshold: 120,
      ...config
    };
  }

  /**
   * @param {import('../entities/MediaProgress.mjs').MediaProgress} progress
   * @param {Object} [contentMeta]
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   */
  classify(progress, contentMeta = {}) {
    const { playhead, duration, watchTime } = progress;
    const percent = progress.percent ?? 0;
    const {
      watchedPercentThreshold,
      minWatchTimeSeconds,
      shortformDurationSeconds,
      shortformPercentThreshold,
      remainingSecondsThreshold
    } = this.config;

    // No progress = unwatched
    if (!playhead || playhead === 0) {
      return 'unwatched';
    }

    // Insufficient actual watch time (anti-seeking protection)
    if (watchTime !== undefined && watchTime < minWatchTimeSeconds) {
      return 'in_progress';
    }

    // Determine threshold based on content length
    const contentDuration = contentMeta.duration || duration || 0;
    const isShortform = contentDuration > 0 && contentDuration < shortformDurationSeconds;
    const percentThreshold = isShortform ? shortformPercentThreshold : watchedPercentThreshold;

    // Check remaining time
    const remaining = contentDuration > 0 ? contentDuration - playhead : Infinity;

    // Watched if percent threshold met OR less than threshold seconds remaining
    if (percent >= percentThreshold || (remaining < remainingSecondsThreshold && remaining >= 0)) {
      return 'watched';
    }

    return 'in_progress';
  }
}
