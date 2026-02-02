// backend/src/1_adapters/content/singing/SingingAdapter.mjs
import path from 'path';
import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  dirExists,
  listDirs
} from '#system/utils/FileIO.mjs';

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

  /**
   * Get item by local ID (without prefix)
   * @param {string} localId - e.g., "hymn/2" or "primary/custom-song"
   * @returns {Promise<Object|null>}
   */
  async getItem(localId) {
    const [collection, ...rest] = localId.split('/');
    const itemId = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);

    // Load collection manifest if exists
    const manifest = this._loadManifest(collection);

    // Load item metadata
    let metadata;
    if (/^\d+$/.test(itemId)) {
      // Numeric ID - use prefix matching
      metadata = loadYamlByPrefix(collectionPath, itemId);
    } else {
      // Non-numeric - direct path lookup
      metadata = loadContainedYaml(collectionPath, itemId);
    }

    if (!metadata) return null;

    // Find media file
    const mediaFile = findMediaFileByPrefix(
      path.join(this.mediaPath, collection),
      metadata.number || itemId
    );

    // Build response with category defaults + manifest overrides
    const style = { ...this._getDefaultStyle(), ...manifest?.style };
    const contentType = manifest?.contentType || 'stanzas';

    return {
      id: `singing:${localId}`,
      source: 'singing',
      category: 'singing',
      collection,
      title: metadata.title || `${collection} ${itemId}`,
      subtitle: metadata.subtitle || `${collection} #${metadata.number || itemId}`,
      mediaUrl: `/api/v1/stream/singing/${localId}`,
      duration: metadata.duration || 0,
      content: {
        type: contentType,
        data: metadata.verses || []
      },
      style,
      metadata: {
        number: metadata.number,
        ...metadata
      }
    };
  }

  /**
   * Load collection manifest
   * @param {string} collection - Collection name
   * @returns {Object|null}
   * @private
   */
  _loadManifest(collection) {
    try {
      return loadContainedYaml(path.join(this.dataPath, collection), 'manifest');
    } catch {
      return null;
    }
  }

  /**
   * Get default style for singing content
   * @returns {Object}
   * @private
   */
  _getDefaultStyle() {
    return {
      fontFamily: 'serif',
      fontSize: '1.4rem',
      textAlign: 'center'
    };
  }
}

export default SingingAdapter;
