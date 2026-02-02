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
   * Get item by local ID (without prefix)
   * @param {string} localId - e.g., "scripture/alma-32" or "talks/ldsgc202410/smith"
   * @returns {Promise<Object|null>}
   */
  async getItem(localId) {
    const [collection, ...rest] = localId.split('/');
    let itemPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);

    // Load collection manifest
    const manifest = this._loadManifest(collection);

    // Apply resolver if specified
    if (manifest?.resolver && itemPath) {
      const resolver = await this._loadResolver(manifest.resolver);
      if (resolver) {
        const resolved = resolver.resolve(itemPath, collectionPath);
        if (resolved) {
          itemPath = resolved;
        }
      }
    }

    // Load item metadata
    const metadata = loadContainedYaml(collectionPath, itemPath);
    if (!metadata) return null;

    // Determine content type
    const contentType = manifest?.contentType || 'paragraphs';
    const contentData = metadata.verses || metadata.content || metadata.paragraphs || [];

    // Find media files
    const mediaFile = this._findMediaFile(collection, itemPath, metadata);

    // Resolve ambient if enabled
    const ambientUrl = manifest?.ambient ? this._resolveAmbientUrl() : null;

    // Build style
    const style = { ...this._getDefaultStyle(), ...manifest?.style };

    return {
      id: `reading:${collection}/${itemPath}`,
      source: 'reading',
      category: 'reading',
      collection,
      title: metadata.title || itemPath,
      subtitle: metadata.speaker || metadata.author || null,
      mediaUrl: `/api/v1/stream/reading/${collection}/${itemPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/reading/${collection}/${itemPath}/video` : null,
      ambientUrl,
      duration: metadata.duration || 0,
      content: {
        type: contentType,
        data: contentData
      },
      style,
      metadata
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
   * Load a resolver by name
   * @param {string} name - Resolver name (e.g., 'scripture')
   * @returns {Promise<Object|null>}
   * @private
   */
  async _loadResolver(name) {
    if (!this.resolvers[name]) {
      try {
        const module = await import(`./resolvers/${name}.mjs`);
        this.resolvers[name] = module.default || module[`${name.charAt(0).toUpperCase() + name.slice(1)}Resolver`];
      } catch {
        return null;
      }
    }
    return this.resolvers[name];
  }

  /**
   * Find media file for an item
   * @param {string} collection - Collection name
   * @param {string} itemPath - Item path
   * @param {Object} metadata - Item metadata
   * @returns {string|null}
   * @private
   */
  _findMediaFile(collection, itemPath, metadata) {
    const searchPath = path.join(this.mediaPath, collection);
    return findMediaFileByPrefix(searchPath, metadata.number || itemPath);
  }

  /**
   * Find video file for an item
   * @param {string} collection - Collection name
   * @param {string} itemPath - Item path
   * @returns {string|null}
   * @private
   */
  _findVideoFile(collection, itemPath) {
    const searchPath = path.join(this.mediaPath, collection);
    return findMediaFileByPrefix(searchPath, itemPath);
  }

  /**
   * Generate random ambient URL
   * @returns {string}
   * @private
   */
  _resolveAmbientUrl() {
    const trackNum = String(Math.floor(Math.random() * 115) + 1).padStart(3, '0');
    return `/api/v1/stream/ambient/${trackNum}`;
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
