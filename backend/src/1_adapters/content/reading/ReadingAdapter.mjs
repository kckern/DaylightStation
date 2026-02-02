// backend/src/1_adapters/content/reading/ReadingAdapter.mjs
import path from 'path';
import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  dirExists,
  listDirs,
  listYamlFiles
} from '#system/utils/FileIO.mjs';

/**
 * Adapter for follow-along reading content (scripture, talks, poetry).
 * Uses the 'reading:' prefix for compound IDs.
 *
 * ID format: reading:{collection}/{path}
 * Examples: reading:scripture/bom, reading:talks/ldsgc
 */
export class ReadingAdapter {
  /**
   * @param {Object} config
   * @param {string} config.dataPath - Path to data files (YAML metadata)
   * @param {string} config.mediaPath - Path to media files
   * @param {Object} [config.mediaProgressMemory] - Media progress memory instance
   */
  constructor({ dataPath, mediaPath, mediaProgressMemory }) {
    this.dataPath = dataPath;
    this.mediaPath = mediaPath;
    this.mediaProgressMemory = mediaProgressMemory || null;
    this.resolvers = {};
  }

  get source() {
    return 'reading';
  }

  get prefixes() {
    return [{ prefix: 'reading' }];
  }

  canResolve(id) {
    return id.startsWith('reading:');
  }

  /**
   * Get storage path for watch state persistence
   * @returns {string}
   */
  getStoragePath() {
    return 'reading';
  }

  /**
   * Get default style for reading content
   * @returns {Object}
   * @private
   */
  _getDefaultStyle() {
    return {
      fontFamily: 'sans-serif',
      fontSize: '1.2rem',
      textAlign: 'left'
    };
  }
}

export default ReadingAdapter;
