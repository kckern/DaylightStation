// backend/src/1_domains/content/services/IMediaProgressClassifier.mjs

/**
 * Interface for classifying media progress status
 */
export class IMediaProgressClassifier {
  /**
   * Classify media progress status
   * @param {import('../entities/MediaProgress.mjs').MediaProgress} progress
   * @param {Object} [contentMeta] - Optional content metadata
   * @param {number} [contentMeta.duration] - Content duration in seconds
   * @param {string} [contentMeta.type] - Content type (movie, episode, etc.)
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   */
  classify(progress, contentMeta = {}) {
    throw new Error('IMediaProgressClassifier.classify must be implemented');
  }
}
