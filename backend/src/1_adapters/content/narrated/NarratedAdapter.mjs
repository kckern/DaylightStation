// backend/src/1_adapters/content/narrated/NarratedAdapter.mjs
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
 * Adapter for follow-along narrated content (scripture, talks, poetry).
 * Uses the 'narrated:' prefix for compound IDs.
 *
 * ID format: narrated:{collection}/{path}
 * Examples: narrated:scripture/bom, narrated:talks/ldsgc
 */
export class NarratedAdapter {
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
    return 'narrated';
  }

  get prefixes() {
    return [{ prefix: 'narrated' }];
  }

  canResolve(id) {
    return id.startsWith('narrated:');
  }

  /**
   * Get storage path for watch state persistence
   * @returns {string}
   */
  getStoragePath() {
    return 'narrated';
  }

  /**
   * Get item by local ID (without prefix)
   * @param {string} localId - e.g., "scripture/alma-32" or "talks/ldsgc202410/smith"
   * @returns {Promise<Object|null>}
   */
  async getItem(id) {
    // Strip source prefix if present (router passes compound ID)
    const localId = id.replace(/^narrated:/, '');
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
      id: `narrated:${collection}/${itemPath}`,
      source: 'narrated',
      category: 'narrated',
      collection,
      title: metadata.title || itemPath,
      subtitle: metadata.speaker || metadata.author || null,
      mediaUrl: `/api/v1/stream/narrated/${collection}/${itemPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/narrated/${collection}/${itemPath}/video` : null,
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
   * Get default style for narrated content
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

  /**
   * List collections, items in a collection, or subfolder contents
   * @param {string} localId - Empty for collections, collection name for items, or path for subfolders
   * @returns {Promise<Object>}
   */
  async getList(localId) {
    if (!localId) {
      // List all collections
      const collections = listDirs(this.dataPath);
      return {
        id: 'narrated:',
        source: 'narrated',
        category: 'narrated',
        itemType: 'container',
        items: collections.map(name => ({
          id: `narrated:${name}`,
          source: 'narrated',
          title: name,
          itemType: 'container'
        }))
      };
    }

    const [collection, ...rest] = localId.split('/');
    const subPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);

    if (!subPath) {
      // List items in collection (may have subfolders)
      const dirs = listDirs(collectionPath);
      const files = listYamlFiles(collectionPath);

      const items = [];

      // Add subfolders as containers (skip manifest folder)
      for (const dir of dirs) {
        if (dir !== 'manifest') {
          items.push({
            id: `narrated:${collection}/${dir}`,
            source: 'narrated',
            title: dir,
            itemType: 'container'
          });
        }
      }

      // Add files as items (skip manifest.yml)
      for (const file of files) {
        if (file !== 'manifest.yml') {
          const item = await this.getItem(`${collection}/${file.replace('.yml', '')}`);
          if (item) items.push(item);
        }
      }

      return {
        id: `narrated:${collection}`,
        source: 'narrated',
        category: 'narrated',
        collection,
        itemType: 'container',
        items
      };
    }

    // Subfolder listing
    const subfolderPath = path.join(collectionPath, subPath);
    const subDirs = listDirs(subfolderPath);
    const files = listYamlFiles(subfolderPath);
    const items = [];

    // Add nested subfolders as containers
    for (const dir of subDirs) {
      items.push({
        id: `narrated:${collection}/${subPath}/${dir}`,
        source: 'narrated',
        title: dir,
        itemType: 'container'
      });
    }

    // Add files as items
    for (const file of files) {
      const item = await this.getItem(`${collection}/${subPath}/${file.replace('.yml', '')}`);
      if (item) items.push(item);
    }

    return {
      id: `narrated:${localId}`,
      source: 'narrated',
      category: 'narrated',
      collection,
      itemType: 'container',
      items
    };
  }

  /**
   * Resolve playable items from a local ID
   * @param {string} localId - Item or collection/folder ID
   * @returns {Promise<Array>}
   */
  async resolvePlayables(localId) {
    const item = await this.getItem(localId);
    if (item && item.mediaUrl) return [item];

    const list = await this.getList(localId);
    return list?.items?.filter(i => i.mediaUrl) || [];
  }
}

export default NarratedAdapter;
