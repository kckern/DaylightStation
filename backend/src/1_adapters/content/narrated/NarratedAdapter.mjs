// backend/src/1_adapters/content/narrated/NarratedAdapter.mjs
import path from 'path';
import {
  loadYamlByPrefix,
  loadContainedYaml,
  findMediaFileByPrefix,
  fileExists,
  dirExists,
  listDirs,
  listYamlFiles
} from '#system/utils/FileIO.mjs';
import { ItemSelectionService } from '#domains/content/index.mjs';

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
   * For scripture volume selectors (e.g., "scripture/nt"), uses ItemSelectionService
   * to return the next chapter based on watch history.
   * @param {string} localId - e.g., "scripture/alma-32" or "talks/ldsgc202410/smith"
   * @returns {Promise<Object|null>}
   */
  async getItem(id) {
    // Strip source prefix if present (router passes compound ID)
    const localId = id.replace(/^narrated:/, '');
    const [collection, ...rest] = localId.split('/');
    let itemPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);
    const mediaCollectionPath = path.join(this.mediaPath, collection);

    // Load collection manifest
    const manifest = this._loadManifest(collection);

    // Track resolved paths for text and audio (may differ for scripture)
    let textPath = itemPath;
    let audioPath = itemPath;
    let resolvedMeta = null;

    // Apply resolver if specified
    if (manifest?.resolver && itemPath) {
      const resolver = await this._loadResolver(manifest.resolver);
      if (resolver) {
        // Check if this is a volume-level request that should use selection
        const resolved = resolver.resolve(itemPath, collectionPath, {
          mediaPath: mediaCollectionPath,
          defaults: manifest?.defaults || {},
          allowVolumeAsContainer: true
        });

        // If resolver indicates this is a container (volume selector), use selection
        if (resolved?.isContainer && resolved.volume) {
          const selectedItem = await this._selectNextItem(resolved, manifest);
          if (selectedItem) {
            return selectedItem;
          }
          // Fall through to default behavior if selection fails
        }

        // Re-resolve without container mode for normal item resolution
        const itemResolved = resolver.resolve(itemPath, collectionPath, {
          mediaPath: mediaCollectionPath,
          defaults: manifest?.defaults || {}
        });

        if (itemResolved) {
          if (typeof itemResolved === 'string') {
            // Legacy resolver returns string
            textPath = itemResolved;
            audioPath = itemResolved;
          } else {
            // New resolver returns object with separate paths
            textPath = itemResolved.textPath;
            audioPath = itemResolved.audioPath;
            resolvedMeta = {
              volume: itemResolved.volume,
              textVersion: itemResolved.textVersion,
              audioRecording: itemResolved.audioRecording,
              verseId: itemResolved.verseId
            };
          }
        }
      }
    }

    // Load item metadata using text path
    const metadata = loadContainedYaml(collectionPath, textPath);
    if (!metadata) return null;

    // Determine content type
    const contentType = manifest?.contentType || 'paragraphs';
    // Handle both object with verses key and array at root level
    const contentData = Array.isArray(metadata)
      ? metadata
      : (metadata.verses || metadata.content || metadata.paragraphs || []);

    // Find media files using audio path
    const mediaFile = this._findMediaFile(collection, audioPath, metadata);

    // Resolve ambient if enabled
    const ambientUrl = manifest?.ambient ? this._resolveAmbientUrl() : null;

    // Build style
    const style = { ...this._getDefaultStyle(), ...manifest?.style };

    // Build canonical ID using text path
    const canonicalId = `narrated:${collection}/${textPath}`;

    // Extract title - handle both object and array metadata
    const titleSource = Array.isArray(metadata) ? metadata[0] : metadata;
    const title = titleSource?.title
      || titleSource?.headings?.heading
      || titleSource?.headings?.title
      || textPath;
    const subtitle = titleSource?.speaker
      || titleSource?.author
      || titleSource?.headings?.section_title
      || null;

    return {
      id: canonicalId,
      source: 'narrated',
      category: 'narrated',
      collection,
      title,
      subtitle,
      thumbnail: this._collectionThumbnail(collection),
      // Use audio path for streaming URL
      mediaUrl: `/api/v1/proxy/local-content/stream/${collection}/${audioPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/narrated/${collection}/${textPath}/video` : null,
      ambientUrl,
      duration: metadata.duration || 0,
      content: {
        type: contentType,
        data: contentData
      },
      style,
      // Include resolution metadata if available
      ...(resolvedMeta && { resolved: resolvedMeta }),
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
   * Resolve collection icon path on disk.
   * Checks manifest `icon` field first, then convention `icon.svg`.
   * @param {string} collection - Collection name (e.g., 'scripture')
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
    return icon ? `/api/v1/local-content/collection-icon/narrated/${collection}` : null;
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
          thumbnail: this._collectionThumbnail(name),
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
   * For scripture volumes, returns items based on bookmark tracking
   * @param {string} localId - Item or collection/folder ID
   * @returns {Promise<Array>}
   */
  async resolvePlayables(localId) {
    // Strip source prefix if present
    const cleanId = localId.replace(/^narrated:/, '');
    const [collection, ...rest] = cleanId.split('/');
    const itemPath = rest.join('/');

    // Check if this is a scripture volume-level request
    if (collection === 'scripture' && itemPath) {
      const manifest = this._loadManifest(collection);
      if (manifest?.resolver === 'scripture') {
        const resolver = await this._loadResolver('scripture');
        if (resolver) {
          const collectionPath = path.join(this.dataPath, collection);
          const mediaCollectionPath = path.join(this.mediaPath, collection);

          // Check if this resolves to a container (volume-only)
          const resolved = resolver.resolve(itemPath, collectionPath, {
            mediaPath: mediaCollectionPath,
            defaults: manifest?.defaults || {},
            allowVolumeAsContainer: true
          });

          if (resolved?.isContainer && resolved.volume) {
            // Volume-level request - return items based on bookmark
            return this._resolveScriptureVolumePlayables(resolved, manifest);
          }
        }
      }
    }

    // Standard item resolution
    const item = await this.getItem(localId);
    if (item && item.mediaUrl) return [item];

    const list = await this.getList(localId);
    return list?.items?.filter(i => i.mediaUrl) || [];
  }

  /**
   * Resolve playable items for a scripture volume using watch history
   * Reads from scriptures.yml to find next chapter to play
   * @param {Object} resolved - Resolved volume info from scripture resolver
   * @param {Object} manifest - Scripture manifest with defaults
   * @returns {Promise<Array>}
   * @private
   */
  async _resolveScriptureVolumePlayables(resolved, manifest) {
    const { volume, textVersion, audioRecording } = resolved;
    const resolver = await this._loadResolver('scripture');
    const volumeRanges = resolver?.VOLUME_RANGES || {};
    const range = volumeRanges[volume];

    if (!range) return [];

    // Read scripture watch history from scriptures.yml
    // Keys are like "plex:nt/kjvf/25065" where 25065 is the first verse of a chapter
    let nextChapterId = range.start;
    let inProgressChapter = null;

    if (this.mediaProgressMemory) {
      try {
        // Get all scripture progress entries
        const allProgress = await this.mediaProgressMemory.getAll('scriptures');

        // Filter to this volume and version, extract chapter verse IDs
        const volumePrefix = `plex:${volume}/${textVersion}/`;
        const chapterProgress = allProgress
          .filter(p => p.itemId?.startsWith(volumePrefix))
          .map(p => {
            const verseId = parseInt(p.itemId.split('/').pop(), 10);
            return { verseId, percent: p.percent || 0 };
          })
          .filter(p => p.verseId >= range.start && p.verseId <= range.end)
          .sort((a, b) => a.verseId - b.verseId);

        // Find in-progress chapter (< 90% watched) or next unwatched
        for (const cp of chapterProgress) {
          if (cp.percent < 90) {
            // Found an in-progress chapter - this is next up
            inProgressChapter = cp.verseId;
            break;
          }
        }

        if (!inProgressChapter && chapterProgress.length > 0) {
          // All watched chapters are complete, find next chapter after highest watched
          const highestWatched = chapterProgress[chapterProgress.length - 1].verseId;
          // We need to find the next chapter start after highestWatched
          // For now, just increment (this is approximate - chapters vary in length)
          nextChapterId = highestWatched + 1;
        }
      } catch {
        // No history, start from beginning
      }
    }

    // Use in-progress chapter if found, otherwise next chapter
    const targetChapterId = inProgressChapter || nextChapterId;

    // Build single item for the target chapter
    const simplePath = `${textVersion}/${targetChapterId}`;
    const audioPath = `${volume}/${audioRecording || textVersion}/${targetChapterId}`;

    return [{
      id: `narrated:scripture/${simplePath}`,
      source: 'narrated',
      category: 'narrated',
      collection: 'scripture',
      verseId: String(targetChapterId),
      volume,
      textVersion,
      audioRecording: audioRecording || textVersion,
      mediaUrl: `/api/v1/proxy/local-content/stream/scripture/${audioPath}`,
      itemIndex: targetChapterId - range.start,
      // Include watch state for ItemSelectionService
      percent: inProgressChapter ? (await this._getChapterPercent(volume, textVersion, targetChapterId)) : 0
    }];
  }

  /**
   * Get watch percent for a specific chapter
   * @private
   */
  async _getChapterPercent(volume, textVersion, verseId) {
    if (!this.mediaProgressMemory) return 0;
    try {
      const key = `plex:${volume}/${textVersion}/${verseId}`;
      const progress = await this.mediaProgressMemory.get(key, 'scriptures');
      return progress?.percent || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Select next item from a scripture volume using ItemSelectionService
   * Called by getItem() for volume-level requests (e.g., scripture/nt)
   * @param {Object} resolved - Resolved volume info from scripture resolver
   * @param {Object} manifest - Scripture manifest with defaults
   * @returns {Promise<Object|null>} Full item for the selected verse, or null
   * @private
   */
  async _selectNextItem(resolved, manifest) {
    // Get candidate items for selection
    const candidates = await this._resolveScriptureVolumePlayables(resolved, manifest);
    if (candidates.length === 0) return null;

    // Apply ItemSelectionService with sequential strategy
    const context = {
      containerType: 'sequential',
      now: new Date()
    };
    const overrides = {
      strategy: 'sequential',
      allowFallback: true
    };

    try {
      const selected = ItemSelectionService.select(candidates, context, overrides);
      if (selected.length === 0) return null;

      // Load full item content for the selected item
      const selectedItem = selected[0];

      // Recursively call getItem with the specific verse ID
      // Use a flag to prevent infinite recursion
      const fullItem = await this._loadFullItem(selectedItem.id, manifest);
      if (fullItem) {
        // Add selection metadata
        fullItem._selection = {
          strategy: 'sequential',
          volume: resolved.volume,
          fromCandidates: candidates.length
        };
      }
      return fullItem;
    } catch (error) {
      // Selection failed, return null to fall back to default behavior
      return null;
    }
  }

  /**
   * Load full item content without triggering selection logic
   * @param {string} id - Item ID
   * @param {Object} manifest - Collection manifest
   * @returns {Promise<Object|null>}
   * @private
   */
  async _loadFullItem(id, manifest) {
    const localId = id.replace(/^narrated:/, '');
    const [collection, ...rest] = localId.split('/');
    const itemPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);
    const mediaCollectionPath = path.join(this.mediaPath, collection);

    let textPath = itemPath;
    let audioPath = itemPath;
    let resolvedMeta = null;

    // Apply resolver without container mode
    if (manifest?.resolver) {
      const resolver = await this._loadResolver(manifest.resolver);
      if (resolver) {
        const resolved = resolver.resolve(itemPath, collectionPath, {
          mediaPath: mediaCollectionPath,
          defaults: manifest?.defaults || {}
        });
        if (resolved && typeof resolved !== 'string') {
          textPath = resolved.textPath;
          audioPath = resolved.audioPath;
          resolvedMeta = {
            volume: resolved.volume,
            textVersion: resolved.textVersion,
            audioRecording: resolved.audioRecording,
            verseId: resolved.verseId
          };
        } else if (typeof resolved === 'string') {
          textPath = resolved;
          audioPath = resolved;
        }
      }
    }

    // Load item metadata
    const metadata = loadContainedYaml(collectionPath, textPath);
    if (!metadata) return null;

    const contentType = manifest?.contentType || 'paragraphs';
    const contentData = Array.isArray(metadata)
      ? metadata
      : (metadata.verses || metadata.content || metadata.paragraphs || []);

    const ambientUrl = manifest?.ambient ? this._resolveAmbientUrl() : null;
    const style = { ...this._getDefaultStyle(), ...manifest?.style };
    const canonicalId = `narrated:${collection}/${textPath}`;

    const titleSource = Array.isArray(metadata) ? metadata[0] : metadata;
    const title = titleSource?.title
      || titleSource?.headings?.heading
      || titleSource?.headings?.title
      || textPath;
    const subtitle = titleSource?.speaker
      || titleSource?.author
      || titleSource?.headings?.section_title
      || null;

    return {
      id: canonicalId,
      source: 'narrated',
      category: 'narrated',
      collection,
      title,
      subtitle,
      thumbnail: this._collectionThumbnail(collection),
      mediaUrl: `/api/v1/proxy/local-content/stream/${collection}/${audioPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/narrated/${collection}/${textPath}/video` : null,
      ambientUrl,
      duration: metadata.duration || 0,
      content: {
        type: contentType,
        data: contentData
      },
      style,
      ...(resolvedMeta && { resolved: resolvedMeta }),
      metadata
    };
  }

  /**
   * Get container type for selection strategy inference
   * @param {string} localId - Item or collection/folder ID
   * @returns {string} Container type (sequential, watchlist, etc.)
   */
  getContainerType(localId) {
    const cleanId = localId.replace(/^narrated:/, '');
    const [collection] = cleanId.split('/');

    // Scripture volumes are sequential - you progress through in order
    if (collection === 'scripture') {
      return 'sequential';
    }

    // Talks and poetry use watchlist-style selection
    return 'watchlist';
  }
}

export default NarratedAdapter;
