// backend/src/1_adapters/content/singing/SingingAdapter.mjs
import path from 'path';

/**
 * Adapter for participatory sing-along content (hymns, primary songs).
 * Uses the 'singing:' prefix for compound IDs.
 *
 * ID format: singing:{collection}/{number}
 * Examples: singing:hymn/123, singing:primary/1
 */
export class SingingAdapter {
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
  }

  get source() {
    return 'singing';
  }

  get prefixes() {
    return [{ prefix: 'singing' }];
  }

  canResolve(id) {
    return id.startsWith('singing:');
  }
}

export default SingingAdapter;
