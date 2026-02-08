// backend/src/1_adapters/content/media/files/FileAdapter.mjs
import path from 'path';
import crypto from 'crypto';
import { parseFile } from 'music-metadata';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ItemSelectionService } from '#domains/content/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  fileExists,
  dirExists,
  listEntries,
  getStats,
  loadYamlSafe
} from '#system/utils/FileIO.mjs';

const MEDIA_PREFIXES = ['', 'audio', 'video', 'img'];

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Media adapter for raw media files.
 * Implements IContentSource for accessing media files on the local filesystem.
 * Supports watch state integration via MediaProgressMemory for resume position tracking.
 */
export class FileAdapter {
  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for media files
   * @param {Object} [config.mediaProgressMemory] - MediaProgressMemory instance for watch state
   * @param {Object} [config.configService] - ConfigService for loading metadata configs
   * @param {string} [config.dataPath] - Path to data directory (for config lookup)
   * @param {string} [config.householdId] - Household ID for config lookup
   * @param {string} [config.cacheBasePath] - Path to cache directory (thumbnails)
   */
  constructor(config) {
    if (!config.mediaBasePath) {
      throw new InfrastructureError('FileAdapter requires mediaBasePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'mediaBasePath'
      });
    }
    this.mediaBasePath = config.mediaBasePath;
    this.mediaProgressMemory = config.mediaProgressMemory || null;
    this.configService = config.configService || null;
    this.dataPath = config.dataPath || null;
    this.householdId = config.householdId || null;
    this.cacheBasePath = config.cacheBasePath || null;

    // Cache for roots config
    this._rootsCache = null;
  }

  /**
   * Get watch state for a specific media key
   * @param {string} mediaKey - Media key (file path)
   * @returns {Object|null} Media progress { percent, seconds, playhead, mediaDuration }
   * @private
   */
  _getMediaProgress(mediaKey) {
    if (!this.mediaProgressMemory) return null;
    // Try both with and without source prefix
    const state = this.mediaProgressMemory.get(mediaKey) ||
                  this.mediaProgressMemory.get(`files:${mediaKey}`) ||
                  this.mediaProgressMemory.get(`media:${mediaKey}`);
    return state || null;
  }

  /**
   * Parse ID3 tags from audio file
   * @param {string} filePath - Full path to the audio file
   * @returns {Promise<Object>} Parsed metadata { artist, album, year, track, genre }
   * @private
   */
  async _parseAudioMetadata(filePath) {
    try {
      const metadata = await (this._parseFile || parseFile)(filePath, { duration: true });
      const common = metadata?.common || {};
      return {
        title: common.title,
        artist: common.artist,
        album: common.album,
        year: common.year,
        track: common.track?.no,
        genre: Array.isArray(common.genre) ? common.genre.join(', ') : common.genre
      };
    } catch (err) {
      // File doesn't have ID3 tags or can't be parsed
      return {};
    }
  }

  /**
   * Load metadata from a folder's metadata.yml file
   * @param {string} metadataPath - Path to metadata file (without extension)
   * @returns {Object|null} Metadata object or null if not found
   * @private
   */
  _loadFolderMetadata(metadataPath) {
    return loadYamlSafe(metadataPath);
  }

  /**
   * Extract cover art from media file
   * @param {string} mediaKey - e.g., "sfx/intro"
   * @returns {Promise<{buffer: Buffer, mimeType: string} | null>}
   */
  async getCoverArt(mediaKey) {
    const resolved = this.resolvePath(mediaKey);
    if (!resolved) return null;

    try {
      const metadata = await (this._parseFile || parseFile)(resolved.path);
      const picture = metadata?.common?.picture;

      if (picture?.length) {
        const mimeType = picture[0].format;
        const data = picture[0].data;

        // Validate MIME type
        if (!VALID_IMAGE_TYPES.includes(mimeType)) {
          return null;
        }

        // Validate size limit
        if (data.length > MAX_COVER_SIZE) {
          return null;
        }

        return {
          buffer: Buffer.from(data),
          mimeType
        };
      }
    } catch (err) {
      console.warn(`Failed to parse cover art for ${mediaKey}:`, err.message);
    }

    return null;
  }

  get source() {
    return 'files';
  }

  get prefixes() {
    return [
      { prefix: 'files' },
      { prefix: 'media' },
      { prefix: 'local' },
      { prefix: 'file' },
      { prefix: 'fs' },
      { prefix: 'freshvideo', idTransform: (id) => `video/news/${id}` }
    ];
  }

  /**
   * Resolve a media key to actual path with fallback prefixes
   * @param {string} mediaKey
   * @returns {{path: string, prefix: string}|null}
   */
  resolvePath(mediaKey) {
    mediaKey = mediaKey.replace(/^\//, '');

    // Normalize and validate path stays within mediaBasePath
    const normalizedKey = path.normalize(mediaKey).replace(/^(\.\.[/\\])+/, '');
    const resolvedBasePath = path.resolve(this.mediaBasePath);

    for (const prefix of MEDIA_PREFIXES) {
      const candidate = prefix
        ? path.join(this.mediaBasePath, prefix, normalizedKey)
        : path.join(this.mediaBasePath, normalizedKey);

      // Validate path containment
      const resolved = path.resolve(candidate);
      if (!resolved.startsWith(resolvedBasePath)) {
        continue; // Skip paths that escape base directory
      }

      if (fileExists(candidate) || dirExists(candidate)) {
        return { path: candidate, prefix };
      }
    }

    // Try adding extensions
    const exts = [...AUDIO_EXTS, ...VIDEO_EXTS];
    for (const ext of exts) {
      for (const prefix of MEDIA_PREFIXES) {
        const candidate = prefix
          ? path.join(this.mediaBasePath, prefix, normalizedKey + ext)
          : path.join(this.mediaBasePath, normalizedKey + ext);

        // Validate path containment
        const resolved = path.resolve(candidate);
        if (!resolved.startsWith(resolvedBasePath)) {
          continue; // Skip paths that escape base directory
        }

        if (fileExists(candidate)) {
          return { path: candidate, prefix };
        }
      }
    }

    return null;
  }

  /**
   * Get MIME type for extension
   * @param {string} ext - File extension including dot
   * @returns {string}
   */
  getMimeType(ext) {
    return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
  }

  /**
   * Get media type category for extension
   * @param {string} ext - File extension
   * @returns {'audio'|'video'|'image'|'unknown'}
   */
  getMediaType(ext) {
    ext = ext.toLowerCase();
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    if (IMAGE_EXTS.includes(ext)) return 'image';
    return 'unknown';
  }

  /**
   * Check if extension is a supported media type
   * @param {string} ext - File extension including dot
   * @returns {boolean}
   */
  isMediaFile(ext) {
    ext = ext.toLowerCase();
    return AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext) || IMAGE_EXTS.includes(ext);
  }

  /**
   * Get configured roots from household config
   * @returns {Promise<Array<{path: string, label: string, mediaType: string}>>}
   */
  async getRoots() {
    if (this._rootsCache) return this._rootsCache;

    // Try ConfigService first (preferred)
    if (this.configService && this.householdId) {
      const config = this.configService.getHouseholdConfig?.(this.householdId, 'local-media');
      if (config?.roots) {
        this._rootsCache = config.roots;
        return this._rootsCache;
      }
    }

    // Fall back to direct YAML read
    if (this.dataPath) {
      const configPath = path.join(this.dataPath, 'household/config/local-media.yml');
      if (fileExists(configPath)) {
        const config = loadYamlSafe(configPath.replace(/\.yml$/, ''));
        this._rootsCache = config?.roots || [];
        return this._rootsCache;
      }
    }

    this._rootsCache = [];
    return this._rootsCache;
  }

  /**
   * Get the full filesystem path for a local ID, with path traversal protection.
   * @param {string} localId - Path relative to media base (e.g., "video/clips/intro.mp4")
   * @returns {string|null}
   */
  getFullPath(localId) {
    const normalizedId = path.normalize(localId).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(this.mediaBasePath, normalizedId);
    const resolvedBasePath = path.resolve(this.mediaBasePath);
    const resolvedFullPath = path.resolve(fullPath);

    if (!resolvedFullPath.startsWith(resolvedBasePath)) {
      return null;
    }

    return fullPath;
  }

  /**
   * Clear caches (for reindexing)
   */
  clearCache() {
    this._rootsCache = null;
  }

  /**
   * Generate thumbnail cache hash
   * @param {string} filePath - Full path to the file
   * @param {number} mtime - File modification time in ms
   * @returns {string}
   * @private
   */
  _getThumbnailHash(filePath, mtime) {
    return crypto.createHash('md5').update(`${filePath}:${mtime}`).digest('hex');
  }

  /**
   * Get thumbnail path for a file
   * @param {string} localId - Path relative to media base
   * @returns {string|null}
   */
  getThumbnailPath(localId) {
    const fullPath = this.getFullPath(localId);
    if (!fullPath || !fileExists(fullPath)) return null;

    const stats = getStats(fullPath);
    if (!stats) return null;

    const hash = this._getThumbnailHash(fullPath, stats.mtimeMs);
    return path.join(this.cacheBasePath, 'thumbnails', `${hash}.jpg`);
  }

  /**
   * Check if thumbnail exists for a file
   * @param {string} localId - Path relative to media base
   * @returns {boolean}
   */
  hasThumbnail(localId) {
    const thumbPath = this.getThumbnailPath(localId);
    return thumbPath && fileExists(thumbPath);
  }

  /**
   * @param {string} id - Compound ID like "media:path/to/file.mp3"
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    // Strip source prefix if present (supports media: and local:)
    const localId = id.replace(/^(files|media|local):/, '');
    const resolved = this.resolvePath(localId);
    if (!resolved) return null;

    try {
      const stats = getStats(resolved.path);
      if (!stats) return null;

      if (stats.isDirectory()) {
        const entries = listEntries(resolved.path);
        const baseName = path.basename(localId);

        // Detect freshvideo paths (video/news/*)
        const isFreshVideo = localId.startsWith('video/news/');
        let title = baseName;
        let thumbnail = null;

        // Try to load metadata.yml from the directory for human-readable title/thumbnail
        const metadataPath = path.join(resolved.path, 'metadata');
        const folderMetadata = this._loadFolderMetadata(metadataPath);
        if (folderMetadata) {
          title = folderMetadata.title || folderMetadata.name || baseName;
          // Check for show.jpg thumbnail in folder
          const showJpgPath = path.join(resolved.path, 'show.jpg');
          if (fileExists(showJpgPath)) {
            thumbnail = `/api/v1/proxy/media/stream/${encodeURIComponent(localId + '/show.jpg')}`;
          }
        } else {
          // Format folder name sensically if no metadata file
          title = baseName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }

        // Count only video files for childCount
        const videoCount = entries.filter(e => e.endsWith('.mp4')).length;

        return new ListableItem({
          id: `files:${localId}`,
          source: 'files',
          localId,
          title,
          type: isFreshVideo ? 'channel' : 'directory',  // Freshvideo sources are channels
          thumbnail,
          itemType: 'container',
          childCount: videoCount || entries.length,
          metadata: {
            type: isFreshVideo ? 'channel' : 'directory',  // Match container type for display
            childCount: videoCount || entries.length,
            librarySectionTitle: isFreshVideo ? 'Fresh Videos' : 'Media'
          }
        });
      }

      const ext = path.extname(resolved.path).toLowerCase();
      const mediaType = this.getMediaType(ext);

      // Load media progress for resume position (canonical format after P0 migration)
      const progress = this._getMediaProgress(localId);
      const resumePosition = progress?.playhead ?? null;
      const duration = progress?.duration ?? null;

      // Parse ID3 tags for audio files
      let audioMetadata = {};
      if (mediaType === 'audio') {
        audioMetadata = await this._parseAudioMetadata(resolved.path);
      }

      // Extract parent folder name for parentTitle (e.g., "audio/sfx/intro.mp3" -> "SFX")
      const pathParts = localId.split('/');
      let parentTitle = null;
      if (pathParts.length > 1) {
        const parentFolder = pathParts[pathParts.length - 2];
        // Format parent folder name nicely
        parentTitle = parentFolder
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());
      }

      // Build thumbnail URL -- video uses ffmpeg-generated thumbnail, audio uses cover art
      // Use resolved path relative to mediaBasePath (includes prefix + extension)
      const relativeMediaPath = path.relative(this.mediaBasePath, resolved.path);
      const thumbnail = mediaType === 'video'
        ? `/api/v1/local/thumbnail/${encodeURIComponent(relativeMediaPath)}`
        : `/api/v1/local-content/cover/${encodeURIComponent(localId)}`;

      // Use ID3 title if available, otherwise filename
      const title = audioMetadata.title || path.basename(localId, ext);

      return new PlayableItem({
        id: `files:${localId}`,
        source: 'files',
        localId,
        title,
        type: mediaType, // 'audio', 'video', or 'image'
        thumbnail,
        mediaType,
        mediaUrl: `/api/v1/proxy/media/stream/${encodeURIComponent(localId)}`,
        duration,
        resumable: mediaType === 'video',
        resumePosition,
        metadata: {
          ...audioMetadata,
          type: mediaType,
          filePath: resolved.path,
          fileSize: stats.size,
          mimeType: MIME_TYPES[ext] || 'application/octet-stream',
          parentTitle,
          librarySectionTitle: 'Media',
          // Include watch state fields in metadata for compatibility
          percent: progress?.percent || null,
          playhead: resumePosition,
          watchTime: progress?.watchTime || null
        }
      });
    } catch (err) {
      // File was deleted or permission denied
      return null;
    }
  }

  /**
   * @param {string} id - Compound ID like "media:path/to/dir"
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    // Strip source prefix if present (supports media:, local:, file:, fs:)
    const localId = id.replace(/^(files|media|local|file|fs):/, '');

    // Empty ID returns configured roots (for local media browsing)
    if (!localId) {
      const roots = await this.getRoots();
      return roots.map(root => new ListableItem({
        id: `files:${root.path}`,
        source: 'files',
        localId: root.path,
        title: root.label,
        itemType: 'container',
        metadata: {
          mediaType: root.mediaType,
          path: root.path
        }
      }));
    }

    const resolved = this.resolvePath(localId);
    if (!resolved) return [];

    try {
      const stats = getStats(resolved.path);
      if (!stats || !stats.isDirectory()) return [];

      const entries = listEntries(resolved.path);
      const items = [];

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        const entryPath = path.join(resolved.path, entry);
        try {
          const entryStats = getStats(entryPath);
          if (!entryStats) continue;

          // Build clean localId for the child entry
          const childLocalId = localId ? `${localId}/${entry}` : entry;

          // Use getItem for rich metadata (thumbnails, ID3 tags, formatted titles, etc.)
          const item = await this.getItem(childLocalId);
          if (item) {
            items.push(item);
          }
        } catch (entryErr) {
          // Skip entries that can't be accessed
          continue;
        }
      }

      return items;
    } catch (err) {
      // Directory was deleted or permission denied
      return [];
    }
  }

  /**
   * @param {string} id
   * @param {Object} [options]
   * @param {boolean} [options.freshvideo] - Apply freshvideo selection strategy
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id, options = {}) {
    // Detect freshvideo paths (video/news/*) and apply strategy
    const isFreshVideo = options.freshvideo || id.startsWith('video/news/');

    // Try as single item first (handles single files like sfx/intro)
    const item = await this.getItem(id);
    if (item && item.isPlayable && item.isPlayable()) {
      return [item];
    }

    // Then try as directory
    const list = await this.getList(id);
    const playables = [];

    for (const listItem of list) {
      if (listItem.itemType === 'leaf') {
        const localId = listItem.getLocalId();
        const playable = await this.getItem(localId);
        if (playable) playables.push(playable);
      } else if (listItem.itemType === 'container') {
        const localId = listItem.getLocalId();
        const children = await this.resolvePlayables(localId, options);
        playables.push(...children);
      }
    }

    // Apply freshvideo strategy if detected
    if (isFreshVideo && playables.length > 0) {
      return this._applyFreshVideoStrategy(playables);
    }

    return playables;
  }

  /**
   * Apply freshvideo selection strategy to items.
   * Extracts date from YYYYMMDD filenames, enriches with watch state,
   * then selects latest unwatched video.
   * @param {PlayableItem[]} items
   * @returns {Promise<PlayableItem[]>}
   * @private
   */
  async _applyFreshVideoStrategy(items) {
    // Enrich items with date from filename
    const enrichedItems = await Promise.all(items.map(async (item) => {
      const filename = item.localId?.split('/').pop() || '';
      const dateMatch = filename.match(/^(\d{8})/);
      const date = dateMatch ? dateMatch[1] : '00000000';

      // Get watch state if available
      let percent = 0;
      let watched = false;
      if (this.mediaProgressMemory) {
        const mediaKey = item.localId || item.id?.replace(/^(files|media):/, '');
        const state = await this.mediaProgressMemory.get(mediaKey, 'media');
        percent = state?.percent || 0;
        watched = percent >= 90;
      }

      return {
        ...item,
        date,
        sourcePriority: 0, // Single source, no priority needed
        percent,
        watched
      };
    }));

    // Apply freshvideo strategy
    const context = {
      containerType: 'freshvideo',
      now: new Date()
    };

    return ItemSelectionService.select(enrichedItems, context);
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'files';
  }

  /**
   * Search media files by filename.
   * @param {Object} query
   * @param {string} query.text - Search text (min 2 chars)
   * @param {string} [query.mediaType] - Filter by media type (audio, video, image)
   * @param {number} [query.take=50] - Max results
   * @returns {Promise<{items: Array, total: number}>}
   */
  async search({ text, mediaType, take = 50 }) {
    if (!text || text.length < 2) return { items: [], total: 0 };

    const searchLower = text.toLowerCase();
    const results = [];

    // Search through media prefix directories
    for (const prefix of MEDIA_PREFIXES) {
      if (results.length >= take) break;

      const searchPath = prefix
        ? path.join(this.mediaBasePath, prefix)
        : this.mediaBasePath;

      if (!dirExists(searchPath)) continue;

      const found = await this._searchDirectory(searchPath, searchLower, mediaType, take - results.length, 0, prefix);
      results.push(...found);
    }

    return { items: results, total: results.length };
  }

  /**
   * Recursively search a directory for matching files
   * @param {string} dirPath - Absolute directory path
   * @param {string} searchText - Lowercase search text
   * @param {string} [mediaType] - Filter by media type
   * @param {number} limit - Max results
   * @param {number} depth - Current recursion depth
   * @param {string} prefix - Media prefix being searched
   * @returns {Promise<Array>}
   * @private
   */
  async _searchDirectory(dirPath, searchText, mediaType, limit, depth, prefix) {
    // Limit depth to prevent runaway recursion
    if (depth > 5 || limit <= 0) return [];

    const results = [];
    const entries = listEntries(dirPath);

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.startsWith('.') || entry.startsWith('_')) continue;

      const entryPath = path.join(dirPath, entry);
      const stats = getStats(entryPath);
      if (!stats) continue;

      // Build localId relative to mediaBasePath
      const relativePath = path.relative(this.mediaBasePath, entryPath);
      const entryLower = entry.toLowerCase();

      if (stats.isDirectory()) {
        // Check if directory name matches
        if (entryLower.includes(searchText)) {
          const item = await this.getItem(relativePath);
          if (item) results.push(item);
        }

        // Recurse into subdirectories
        if (results.length < limit) {
          const subResults = await this._searchDirectory(
            entryPath, searchText, mediaType, limit - results.length, depth + 1, prefix
          );
          results.push(...subResults);
        }
      } else {
        const ext = path.extname(entry).toLowerCase();
        const fileMediaType = this.getMediaType(ext);

        // Skip if mediaType filter doesn't match
        if (mediaType && fileMediaType !== mediaType) continue;

        // Skip non-media files
        if (fileMediaType === 'unknown') continue;

        const baseName = path.basename(entry, ext).toLowerCase();
        if (baseName.includes(searchText) || entryLower.includes(searchText)) {
          const item = await this.getItem(relativePath);
          if (item) results.push(item);
        }
      }
    }

    return results;
  }

  /**
   * Get search capabilities for ContentQueryService
   * @returns {{canonical: string[], specific: string[]}}
   */
  getSearchCapabilities() {
    return {
      canonical: ['text', 'mediaType'],
      specific: []
    };
  }

  // ---------------------------------------------------------------------------
  // Sibling resolution (ISiblingsCapable)
  // ---------------------------------------------------------------------------

  /**
   * Resolve siblings for file-based items using path-based parent resolution.
   * Handles freshvideo (video/news/*) and general directory navigation.
   * Returns null only if path has no parent (root-level item).
   *
   * @param {string} compoundId - e.g., "files:video/news/channel/episode.mp4" or "video/news"
   * @returns {Promise<{parent: Object, items: Array}|null>}
   */
  async resolveSiblings(compoundId) {
    // Strip source prefix if present
    const localId = compoundId.replace(/^(files|media|local|file|fs):/, '');

    if (!localId || !localId.includes('/')) {
      return null; // Root-level item, no parent to resolve
    }

    const parts = localId.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const parentName = parts[parts.length - 2] || parentPath;

    // Get parent item for richer metadata (title, thumbnail)
    const parentItem = await this.getItem(parentPath);
    const parent = parentItem ? {
      id: parentItem.id || `files:${parentPath}`,
      title: parentItem.title || parentName,
      source: 'files',
      thumbnail: parentItem.thumbnail || null,
      parentId: null,
      libraryId: null
    } : {
      id: `files:${parentPath}`,
      title: parentName,
      source: 'files',
      thumbnail: null,
      parentId: null,
      libraryId: null
    };

    const items = await this.getList(`files:${parentPath}`);
    const listItems = Array.isArray(items) ? items : (items?.children || []);

    return { parent, items: listItems };
  }
}

export default FileAdapter;
