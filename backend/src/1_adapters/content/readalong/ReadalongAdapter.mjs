// backend/src/1_adapters/content/readalong/ReadalongAdapter.mjs
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
import { generateReference } from 'scripture-guide';

/**
 * Adapter for follow-along readalong content (scripture, talks, poetry).
 * Uses the 'readalong:' prefix for compound IDs.
 *
 * ID format: readalong:{collection}/{path}
 * Examples: readalong:scripture/bom, readalong:talks/ldsgc
 */
export class ReadalongAdapter {
  /**
   * @param {Object} config
   * @param {string} config.dataPath - Path to data files (YAML metadata)
   * @param {string} config.mediaPath - Default path to media files
   * @param {Object<string, string>} [config.mediaPathMap] - Optional per-collection media base paths
   * @param {Object} [config.mediaProgressMemory] - Media progress memory instance
   */
  constructor({ dataPath, mediaPath, mediaPathMap, mediaProgressMemory }) {
    this.dataPath = dataPath;
    this.mediaPath = mediaPath;
    this.mediaPathMap = mediaPathMap || {};
    this.mediaProgressMemory = mediaProgressMemory || null;
    this.resolvers = {};
  }

  get source() {
    return 'readalong';
  }

  get contentFormat() {
    return 'readalong';
  }

  get prefixes() {
    return [{ prefix: 'readalong' }];
  }

  canResolve(id) {
    return id.startsWith('readalong:');
  }

  /**
   * Get storage path for watch state persistence.
   * Returns manifest.storagePath if configured, otherwise 'readalong'.
   * @param {string} [id] - Item ID (compound or local) to determine collection
   * @returns {string}
   */
  getStoragePath(id) {
    if (id) {
      const localId = id.replace(/^readalong:/, '');
      const collection = localId.split('/')[0];
      const manifest = this._loadManifest(collection);
      if (manifest?.storagePath) return manifest.storagePath;
    }
    return 'readalong';
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
    const localId = id.replace(/^readalong:/, '');
    const [collection, ...rest] = localId.split('/');
    let itemPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);
    const mediaCollectionPath = path.join(this._getMediaBasePath(collection), collection);

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
    const canonicalId = `readalong:${collection}/${textPath}`;

    // Extract title - handle both object and array metadata
    const titleSource = Array.isArray(metadata) ? metadata[0] : metadata;
    const { title, subtitle } = this._extractTitles(manifest, titleSource, resolvedMeta, textPath);

    return {
      id: canonicalId,
      source: 'readalong',
      category: 'readalong',
      collection,
      title,
      subtitle,
      thumbnail: this._collectionThumbnail(collection),
      // Use audio path for streaming URL
      mediaUrl: `/api/v1/stream/readalong/${collection}/${audioPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/readalong/${collection}/${textPath}/video` : null,
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
    const searchPath = path.join(this._getMediaBasePath(collection), collection);
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
    const searchPath = path.join(this._getMediaBasePath(collection), collection);
    return findMediaFileByPrefix(searchPath, itemPath);
  }

  /**
   * Resolve media base path for a collection.
   * @param {string} collection
   * @returns {string}
   * @private
   */
  _getMediaBasePath(collection) {
    return this.mediaPathMap?.[collection] || this.mediaPath;
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
    return icon ? `/api/v1/local-content/collection-icon/readalong/${collection}` : null;
  }

  /**
   * Get default style for readalong content
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
   * Extract title and subtitle for an item.
   * When manifest specifies titleGenerator: 'scripture-reference', uses
   * generateReference() to build "Book Chapter" from the verse ID.
   * @param {Object|null} manifest - Collection manifest
   * @param {Object} titleSource - First metadata entry
   * @param {Object|null} resolvedMeta - Resolution metadata with verseId
   * @param {string} fallback - Fallback title (textPath)
   * @returns {{ title: string, subtitle: string|null }}
   * @private
   */
  _extractTitles(manifest, titleSource, resolvedMeta, fallback) {
    let title = null;
    let subtitle = null;

    // Use manifest-configured title generator
    if (manifest?.titleGenerator === 'scripture-reference' && resolvedMeta?.verseId) {
      try {
        const ref = generateReference(parseInt(resolvedMeta.verseId, 10));
        // Strip verse number: "Luke 4:1" → "Luke 4"
        title = ref?.replace(/:\d+$/, '') || null;
        // Use heading as subtitle
        subtitle = titleSource?.headings?.heading || null;
      } catch {
        // Fall through to default
      }
    }

    if (!title) {
      title = titleSource?.title
        || titleSource?.headings?.heading
        || titleSource?.headings?.title
        || fallback;
      subtitle = titleSource?.speaker
        || titleSource?.author
        || titleSource?.headings?.section_title
        || null;
    }

    return { title, subtitle };
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
        id: 'readalong:',
        source: 'readalong',
        category: 'readalong',
        itemType: 'container',
        items: collections.map(name => ({
          id: `readalong:${name}`,
          source: 'readalong',
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
            id: `readalong:${collection}/${dir}`,
            source: 'readalong',
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
        id: `readalong:${collection}`,
        source: 'readalong',
        category: 'readalong',
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
        id: `readalong:${collection}/${subPath}/${dir}`,
        source: 'readalong',
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
      id: `readalong:${localId}`,
      source: 'readalong',
      category: 'readalong',
      collection,
      itemType: 'container',
      items
    };
  }

  /**
   * Resolve playable items from a local ID.
   * For volumes with a manifest resolver, returns items based on bookmark tracking.
   * @param {string} localId - Item or collection/folder ID
   * @returns {Promise<Array>}
   */
  async resolvePlayables(localId) {
    // Strip source prefix if present
    const cleanId = localId.replace(/^readalong:/, '');
    const [collection, ...rest] = cleanId.split('/');
    const itemPath = rest.join('/');

    // Check if this is a volume-level request with a resolver
    if (itemPath) {
      const manifest = this._loadManifest(collection);
      if (manifest?.resolver) {
        const resolver = await this._loadResolver(manifest.resolver);
        if (resolver) {
          const collectionPath = path.join(this.dataPath, collection);
          const mediaCollectionPath = path.join(this._getMediaBasePath(collection), collection);

          // Check if this resolves to a container (volume-only)
          const resolved = resolver.resolve(itemPath, collectionPath, {
            mediaPath: mediaCollectionPath,
            defaults: manifest?.defaults || {},
            allowVolumeAsContainer: true
          });

          if (resolved?.isContainer && resolved.volume) {
            // Volume-level request - return items based on bookmark
            return this._resolveContainerPlayables(resolved, manifest);
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
   * Resolve playable items for a container volume using watch history.
   * Reads from the configured storage path to find next item to play.
   * @param {Object} resolved - Resolved volume info from resolver
   * @param {Object} manifest - Collection manifest with defaults
   * @returns {Promise<Array>}
   * @private
   */
  async _resolveContainerPlayables(resolved, manifest) {
    const { volume, textVersion, audioRecording } = resolved;
    const resolver = await this._loadResolver('scripture');
    const volumeRanges = resolver?.VOLUME_RANGES || {};
    const range = volumeRanges[volume];

    if (!range) return [];

    // Read scripture watch history
    // Keys may be legacy "plex:nt/kjvf/25065" or new "readalong:scripture/nt/kjvf/25065"
    // or legacy narrated:scripture/nt/kjvf/25065
    let nextChapterId = range.start;
    let inProgressChapter = null;

    if (this.mediaProgressMemory) {
      try {
        const chapterProgress = await this._collectProgress(volume, textVersion, range);

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
      id: `readalong:scripture/${simplePath}`,
      source: 'readalong',
      category: 'readalong',
      collection: 'scripture',
      verseId: String(targetChapterId),
      volume,
      textVersion,
      audioRecording: audioRecording || textVersion,
      mediaUrl: `/api/v1/stream/readalong/scripture/${audioPath}`,
      itemIndex: targetChapterId - range.start,
      // Include watch state for ItemSelectionService
      percent: inProgressChapter ? (await this._getItemPercent(volume, textVersion, targetChapterId)) : 0
    }];
  }

  /**
   * Get watch percent for a specific item.
   * Checks legacy (plex:) and readalong/narrated key formats.
   * @private
   */
  async _getItemPercent(volume, textVersion, verseId) {
    if (!this.mediaProgressMemory) return 0;
    try {
      // Check scriptures.yml with both key formats
      const legacyKey = `plex:${volume}/${textVersion}/${verseId}`;
      const readalongKey = `readalong:scripture/${volume}/${textVersion}/${verseId}`;
      const narratedKey = `narrated:scripture/${volume}/${textVersion}/${verseId}`;

      const legacyProgress = await this.mediaProgressMemory.get(legacyKey, 'scriptures');
      if (legacyProgress?.percent) return legacyProgress.percent;

      const readalongProgress = await this.mediaProgressMemory.get(readalongKey, 'scriptures');
      if (readalongProgress?.percent) return readalongProgress.percent;

      const narratedProgress = await this.mediaProgressMemory.get(narratedKey, 'scriptures');
      if (narratedProgress?.percent) return narratedProgress.percent;

      // Fallback: check readalong.yml for old entries written there
      const fallbackReadalong = await this.mediaProgressMemory.get(readalongKey, 'readalong');
      if (fallbackReadalong?.percent) return fallbackReadalong.percent;

      // Fallback: check narrated.yml for old entries written there
      const fallbackNarrated = await this.mediaProgressMemory.get(narratedKey, 'narrated');
      return fallbackNarrated?.percent || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Collect progress from all known storage locations.
   * Checks primary storage with plex:, readalong:, and narrated: key formats,
   * then falls back to readalong.yml and narrated.yml if no matches found.
   * @param {string} volume - Volume name
   * @param {string} textVersion - Text version
   * @param {Object} range - { start, end } ID range for the volume
   * @returns {Promise<Array<{ verseId: number, percent: number }>>} Sorted progress entries
   * @private
   */
  async _collectProgress(volume, textVersion, range) {
    const legacyPrefix = `plex:${volume}/${textVersion}/`;
    const readalongPrefix = `readalong:scripture/${volume}/${textVersion}/`;
    const narratedPrefix = `narrated:scripture/${volume}/${textVersion}/`;

    // Primary: read from scriptures.yml
    const allProgress = await this.mediaProgressMemory.getAll('scriptures');

    // Extract verse IDs from both key formats
    const seen = new Map(); // verseId → highest percent
    for (const p of allProgress) {
      let verseId = null;
      if (p.itemId?.startsWith(legacyPrefix)) {
        verseId = parseInt(p.itemId.split('/').pop(), 10);
      } else if (p.itemId?.startsWith(readalongPrefix)) {
        verseId = parseInt(p.itemId.split('/').pop(), 10);
      } else if (p.itemId?.startsWith(narratedPrefix)) {
        verseId = parseInt(p.itemId.split('/').pop(), 10);
      }
      if (verseId && verseId >= range.start && verseId <= range.end) {
        const existing = seen.get(verseId);
        const percent = p.percent || 0;
        if (!existing || percent > existing) {
          seen.set(verseId, percent);
        }
      }
    }

    // Fallback: if no matches in scriptures.yml, check readalong.yml
    if (seen.size === 0) {
      const fallbackProgress = await this.mediaProgressMemory.getAll('readalong');
      for (const p of fallbackProgress) {
        if (p.itemId?.startsWith(readalongPrefix)) {
          const verseId = parseInt(p.itemId.split('/').pop(), 10);
          if (verseId && verseId >= range.start && verseId <= range.end) {
            const existing = seen.get(verseId);
            const percent = p.percent || 0;
            if (!existing || percent > existing) {
              seen.set(verseId, percent);
            }
          }
        }
      }
    }

    // Fallback: if still empty, check narrated.yml
    if (seen.size === 0) {
      const fallbackProgress = await this.mediaProgressMemory.getAll('narrated');
      for (const p of fallbackProgress) {
        if (p.itemId?.startsWith(narratedPrefix)) {
          const verseId = parseInt(p.itemId.split('/').pop(), 10);
          if (verseId && verseId >= range.start && verseId <= range.end) {
            const existing = seen.get(verseId);
            const percent = p.percent || 0;
            if (!existing || percent > existing) {
              seen.set(verseId, percent);
            }
          }
        }
      }
    }

    return Array.from(seen.entries())
      .map(([verseId, percent]) => ({ verseId, percent }))
      .sort((a, b) => a.verseId - b.verseId);
  }

  /**
   * Select next item from a volume using ItemSelectionService.
   * Called by getItem() for volume-level requests.
   * @param {Object} resolved - Resolved volume info from resolver
   * @param {Object} manifest - Collection manifest with defaults
   * @returns {Promise<Object|null>} Full item for the selected entry, or null
   * @private
   */
  async _selectNextItem(resolved, manifest) {
    // Get candidate items for selection
    const candidates = await this._resolveContainerPlayables(resolved, manifest);
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
    } catch {
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
    const localId = id.replace(/^readalong:/, '');
    const [collection, ...rest] = localId.split('/');
    const itemPath = rest.join('/');
    const collectionPath = path.join(this.dataPath, collection);
    const mediaCollectionPath = path.join(this._getMediaBasePath(collection), collection);

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
    const canonicalId = `readalong:${collection}/${textPath}`;

    const titleSource = Array.isArray(metadata) ? metadata[0] : metadata;
    const { title, subtitle } = this._extractTitles(manifest, titleSource, resolvedMeta, textPath);

    return {
      id: canonicalId,
      source: 'readalong',
      category: 'readalong',
      collection,
      title,
      subtitle,
      thumbnail: this._collectionThumbnail(collection),
      mediaUrl: `/api/v1/stream/readalong/${collection}/${audioPath}`,
      videoUrl: metadata.videoFile ? `/api/v1/stream/readalong/${collection}/${textPath}/video` : null,
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
    const cleanId = localId.replace(/^readalong:/, '');
    const [collection] = cleanId.split('/');
    const manifest = this._loadManifest(collection);
    return manifest?.containerType || 'watchlist';
  }

  // ---------------------------------------------------------------------------
  // Sibling resolution (ISiblingsCapable)
  // ---------------------------------------------------------------------------

  /**
   * Resolve siblings for readalong items.
   * Uses path-based parent resolution within collections.
   * e.g., "readalong:talks/ldsgc/ldsgc202510/12" → parent is "talks/ldsgc/ldsgc202510"
   *
   * @param {string} compoundId - e.g., "readalong:scripture/bom-alma-32"
   * @returns {Promise<{parent: Object|null, items: Array}|null>}
   */
  async resolveSiblings(compoundId) {
    const localId = compoundId.replace(/^readalong:/, '');
    if (!localId) return null;

    // Path-based parent: strip last segment
    if (localId.includes('/')) {
      const parts = localId.split('/');
      const parentPath = parts.slice(0, -1).join('/');
      const parentName = parts[parts.length - 2] || parentPath;

      const listResult = await this.getList(parentPath);
      const items = Array.isArray(listResult)
        ? listResult
        : (listResult?.items || listResult?.children || []);

      const parent = {
        id: `readalong:${parentPath}`,
        title: parentName,
        source: 'readalong',
        thumbnail: items[0]?.thumbnail || null,
        parentId: null,
        libraryId: null
      };

      return { parent, items };
    }

    // Single-segment ID (collection root like "scripture") — list the collection
    const listResult = await this.getList(localId);
    const items = Array.isArray(listResult)
      ? listResult
      : (listResult?.items || listResult?.children || []);

    const titleized = localId.charAt(0).toUpperCase() + localId.slice(1);
    const parent = {
      id: `readalong:${localId}`,
      title: titleized,
      source: 'readalong',
      thumbnail: items[0]?.thumbnail || null,
      parentId: null,
      libraryId: null
    };

    return { parent, items };
  }
}

export default ReadalongAdapter;