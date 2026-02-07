// backend/src/1_adapters/content/singalong/SingalongAdapter.mjs
import path from 'path';
import { parseFile } from 'music-metadata';
import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  fileExists,
  dirExists,
  listDirs,
  listYamlFiles
} from '#system/utils/FileIO.mjs';

/**
 * Adapter for participatory sing-along content (hymns, primary songs).
 * Uses the 'singalong:' prefix for compound IDs.
 *
 * ID format: singalong:{collection}/{number}
 * Examples: singalong:hymn/123, singalong:primary/1
 */
export class SingalongAdapter {
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
    return 'singalong';
  }

  get prefixes() {
    return [{ prefix: 'singalong' }];
  }

  canResolve(id) {
    return id.startsWith('singalong:');
  }

  /**
   * Get item by local ID (without prefix)
   * @param {string} localId - e.g., "hymn/2" or "primary/custom-song"
   * @returns {Promise<Object|null>}
   */
  async getItem(id) {
    // Strip source prefix if present (router passes compound ID)
    const localId = id.replace(/^singalong:/, '');
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

    // Get duration from YAML metadata, or read from media file
    let duration = metadata.duration || 0;
    if (!duration && mediaFile) {
      try {
        const meta = await parseFile(mediaFile, { duration: true });
        duration = parseInt(meta?.format?.duration) || 0;
      } catch {
        // Ignore metadata parsing errors
      }
    }

    // Build response with category defaults + manifest overrides
    const style = { ...this._getDefaultStyle(), ...manifest?.style };
    const contentType = manifest?.contentType || 'stanzas';

    return {
      id: `singalong:${localId}`,
      source: 'singalong',
      category: 'singalong',
      collection,
      title: metadata.title || `${collection} ${itemId}`,
      subtitle: metadata.subtitle || `${collection} #${metadata.number || itemId}`,
      thumbnail: this._collectionThumbnail(collection),
      mediaUrl: `/api/v1/stream/singalong/${localId}`,
      duration,
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
   * Resolve collection icon path on disk.
   * Checks manifest `icon` field first, then convention `icon.svg`.
   * @param {string} collection - Collection name (e.g., 'hymn')
   * @returns {string|null} Absolute file path or null
   */
  resolveCollectionIcon(collection) {
    const collectionPath = path.join(this.dataPath, collection);
    const manifest = this._loadManifest(collection);
    if (manifest?.icon) {
      const explicit = path.join(collectionPath, manifest.icon);
      if (fileExists(explicit)) return explicit;
    }
    const convention = path.join(collectionPath, 'icon.svg');
    if (fileExists(convention)) return convention;
    return null;
  }

  /**
   * Build a thumbnail URL for a collection if an icon exists.
   * @param {string} collection - Collection name
   * @returns {string|null}
   * @private
   */
  _collectionThumbnail(collection) {
    const icon = this.resolveCollectionIcon(collection);
    return icon ? `/api/v1/local-content/collection-icon/singalong/${collection}` : null;
  }

  /**
   * Get default style for singalong content
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

  /**
   * List collections or items in a collection
   * @param {string} localId - Empty for collections, or collection name for items
   * @returns {Promise<Object>}
   */
  async getList(localId) {
    if (!localId) {
      // List all collections
      const collections = listDirs(this.dataPath);
      return {
        id: 'singalong:',
        source: 'singalong',
        category: 'singalong',
        itemType: 'container',
        items: collections.map(name => ({
          id: `singalong:${name}`,
          source: 'singalong',
          title: name,
          thumbnail: this._collectionThumbnail(name),
          itemType: 'container'
        }))
      };
    }

    const [collection, ...rest] = localId.split('/');
    const subPath = rest.join('/');

    if (!subPath) {
      // List items in collection
      const collectionPath = path.join(this.dataPath, collection);
      const files = listYamlFiles(collectionPath);

      const items = [];
      for (const file of files) {
        const match = file.match(/^0*(\d+)/);
        if (match) {
          const item = await this.getItem(`${collection}/${match[1]}`);
          if (item) items.push(item);
        }
      }

      return {
        id: `singalong:${collection}`,
        source: 'singalong',
        category: 'singalong',
        collection,
        itemType: 'container',
        items
      };
    }

    // Subfolder listing - return the item
    return this.getItem(localId);
  }

  /**
   * Resolve playable items from a local ID
   * @param {string} localId - Item or collection ID
   * @returns {Promise<Array>}
   */
  async resolvePlayables(localId) {
    const item = await this.getItem(localId);
    if (item) return [item];

    const list = await this.getList(localId);
    return list?.items || [];
  }

  /**
   * Get storage path for watch state persistence
   * @returns {string}
   */
  getStoragePath() {
    return 'singalong';
  }

  /**
   * Search capabilities for ContentQueryService
   */
  getSearchCapabilities() {
    return {
      canonical: ['text'],
      specific: ['collection']
    };
  }

  /**
   * Search singalong content by text
   * @param {Object} query - Search query
   * @param {string} query.text - Text to search for
   * @param {string} [query.collection] - Limit to specific collection
   * @param {number} [query.take] - Limit results
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search(query) {
    const { text, collection, take = 50 } = query;
    const searchText = (text || '').toLowerCase();
    const items = [];

    // Get collections to search
    const collections = collection
      ? [collection]
      : listDirs(this.dataPath);

    for (const coll of collections) {
      const collectionPath = path.join(this.dataPath, coll);
      if (!dirExists(collectionPath)) continue;

      const files = listYamlFiles(collectionPath);
      for (const file of files) {
        // Skip manifest files
        if (file === 'manifest.yml') continue;

        const match = file.match(/^0*(\d+)/);
        if (!match) continue;

        const itemNum = match[1];
        const item = await this.getItem(`${coll}/${itemNum}`);
        if (!item) continue;

        // Match on title or number
        const titleMatch = item.title?.toLowerCase().includes(searchText);
        const numMatch = itemNum.includes(searchText);

        if (titleMatch || numMatch || !searchText) {
          items.push(item);
          if (items.length >= take) break;
        }
      }
      if (items.length >= take) break;
    }

    return { items, total: items.length };
  }
}

export default SingalongAdapter;