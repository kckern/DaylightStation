// backend/src/1_adapters/content/media/local-media/LocalMediaAdapter.mjs
import path from 'path';
import crypto from 'crypto';
import { ListableItem } from '#domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '#domains/content/capabilities/Playable.mjs';
import { ContentCategory } from '#domains/content/value-objects/ContentCategory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  fileExists,
  dirExists,
  listEntries,
  getStats,
  loadYaml
} from '#system/utils/FileIO.mjs';

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
  '.webp': 'image/webp'
};

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

/**
 * LocalMediaAdapter - Browse configured filesystem paths as content sources.
 *
 * Configuration in household/config/local-media.yml:
 * ```yaml
 * roots:
 *   - path: video/clips
 *     label: Video Clips
 *     mediaType: video
 * ```
 *
 * ID format: local:{path}
 * Example: local:video/clips/intro.mp4
 */
export class LocalMediaAdapter {
  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for media files
   * @param {string} config.dataPath - Path to data directory (for config)
   * @param {string} config.cacheBasePath - Path to cache directory
   * @param {string} [config.householdId] - Household ID for config lookup
   * @param {Object} [config.configService] - ConfigService for reading household config
   * @param {Object} [config.mediaProgressMemory] - MediaProgressMemory for watch state
   */
  constructor(config) {
    if (!config.mediaBasePath) {
      throw new InfrastructureError('LocalMediaAdapter requires mediaBasePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'mediaBasePath'
      });
    }

    this.mediaBasePath = config.mediaBasePath;
    this.dataPath = config.dataPath;
    this.cacheBasePath = config.cacheBasePath;
    this.householdId = config.householdId;
    this.configService = config.configService;
    this.mediaProgressMemory = config.mediaProgressMemory || null;

    // Cache for roots config and metadata index
    this._rootsCache = null;
    this._indexCache = null;
  }

  get source() {
    return 'local';
  }

  get prefixes() {
    return [{ prefix: 'local' }];
  }

  /**
   * Get configured roots from household config
   * @returns {Array<{path: string, label: string, mediaType: string}>}
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
    const configPath = path.join(this.dataPath, 'household/config/local-media.yml');
    if (fileExists(configPath)) {
      const config = loadYaml(configPath.replace(/\.yml$/, ''));
      this._rootsCache = config?.roots || [];
      return this._rootsCache;
    }

    this._rootsCache = [];
    return this._rootsCache;
  }

  /**
   * Get the full filesystem path for a local ID
   * @param {string} localId - Path relative to media base (e.g., "video/clips/intro.mp4")
   * @returns {string|null}
   */
  getFullPath(localId) {
    // Normalize and validate path stays within mediaBasePath
    const normalizedId = path.normalize(localId).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(this.mediaBasePath, normalizedId);
    const resolvedBasePath = path.resolve(this.mediaBasePath);
    const resolvedFullPath = path.resolve(fullPath);

    // Security: ensure path doesn't escape base directory
    if (!resolvedFullPath.startsWith(resolvedBasePath)) {
      return null;
    }

    return fullPath;
  }

  /**
   * Get media type for file extension
   * @param {string} ext - File extension including dot
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
   * @param {string} ext
   * @returns {boolean}
   */
  isMediaFile(ext) {
    ext = ext.toLowerCase();
    return AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext) || IMAGE_EXTS.includes(ext);
  }

  /**
   * Get watch state for a media item
   * @param {string} localId
   * @returns {Object|null}
   */
  _getMediaProgress(localId) {
    if (!this.mediaProgressMemory) return null;
    const state = this.mediaProgressMemory.get(localId) ||
                  this.mediaProgressMemory.get(`local:${localId}`);
    return state || null;
  }

  /**
   * Generate thumbnail cache hash
   * @param {string} filePath
   * @param {number} mtime - File modification time
   * @returns {string}
   */
  _getThumbnailHash(filePath, mtime) {
    return crypto.createHash('md5').update(`${filePath}:${mtime}`).digest('hex');
  }

  /**
   * Get thumbnail path for a file
   * @param {string} localId
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
   * Check if thumbnail exists
   * @param {string} localId
   * @returns {boolean}
   */
  hasThumbnail(localId) {
    const thumbPath = this.getThumbnailPath(localId);
    return thumbPath && fileExists(thumbPath);
  }

  /**
   * @param {string} id - Compound ID like "local:video/clips/intro.mp4" or just "video/clips/intro.mp4"
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    const localId = id.replace(/^local:/, '');
    const fullPath = this.getFullPath(localId);
    if (!fullPath) return null;

    const stats = getStats(fullPath);
    if (!stats) return null;

    if (stats.isDirectory()) {
      const entries = listEntries(fullPath);
      const mediaEntries = entries.filter(e => {
        const ext = path.extname(e).toLowerCase();
        return !e.startsWith('.') && (this.isMediaFile(ext) || dirExists(path.join(fullPath, e)));
      });

      return new ListableItem({
        id: `local:${localId}`,
        source: 'local',
        localId,
        title: path.basename(localId),
        itemType: 'container',
        childCount: mediaEntries.length,
        metadata: {
          category: ContentCategory.CONTAINER,
          path: localId
        }
      });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mediaType = this.getMediaType(ext);

    if (mediaType === 'unknown') return null;

    // Get watch state
    const progress = this._getMediaProgress(localId);
    const resumePosition = progress?.playhead || progress?.seconds || null;
    const duration = progress?.mediaDuration || null;

    // Check for thumbnail
    const thumbnailUrl = this.hasThumbnail(localId)
      ? `/api/v1/local/thumbnail/${encodeURIComponent(localId)}`
      : null;

    return new PlayableItem({
      id: `local:${localId}`,
      source: 'local',
      localId,
      title: path.basename(localId, ext),
      mediaType,
      mediaUrl: `/api/v1/local/stream/${encodeURIComponent(localId)}`,
      duration,
      resumable: mediaType === 'video',
      resumePosition,
      imageUrl: thumbnailUrl,
      metadata: {
        category: ContentCategory.MEDIA,
        path: path.dirname(localId),
        size: stats.size,
        mimeType: MIME_TYPES[ext] || 'application/octet-stream',
        modifiedAt: stats.mtime.toISOString(),
        percent: progress?.percent || null,
        playhead: resumePosition,
        watchTime: progress?.watchTime || null
      }
    });
  }

  /**
   * @param {string} id - Compound ID or empty string for roots
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    const localId = id.replace(/^local:/, '');

    // Empty ID returns configured roots
    if (!localId) {
      const roots = await this.getRoots();
      return roots.map(root => new ListableItem({
        id: `local:${root.path}`,
        source: 'local',
        localId: root.path,
        title: root.label,
        itemType: 'container',
        metadata: {
          category: ContentCategory.CONTAINER,
          mediaType: root.mediaType,
          path: root.path
        }
      }));
    }

    const fullPath = this.getFullPath(localId);
    if (!fullPath || !dirExists(fullPath)) return [];

    const entries = listEntries(fullPath);
    const items = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const entryPath = path.join(fullPath, entry);
      const entryId = localId ? `${localId}/${entry}` : entry;
      const stats = getStats(entryPath);
      if (!stats) continue;

      if (stats.isDirectory()) {
        const childEntries = listEntries(entryPath).filter(e => !e.startsWith('.'));
        items.push(new ListableItem({
          id: `local:${entryId}`,
          source: 'local',
          localId: entryId,
          title: entry,
          itemType: 'container',
          childCount: childEntries.length,
          metadata: {
            category: ContentCategory.CONTAINER,
            path: entryId
          }
        }));
      } else {
        const ext = path.extname(entry).toLowerCase();
        if (!this.isMediaFile(ext)) continue;

        const mediaType = this.getMediaType(ext);
        const thumbnailUrl = this.hasThumbnail(entryId)
          ? `/api/v1/local/thumbnail/${encodeURIComponent(entryId)}`
          : null;

        items.push(new ListableItem({
          id: `local:${entryId}`,
          source: 'local',
          localId: entryId,
          title: path.basename(entry, ext),
          itemType: 'leaf',
          imageUrl: thumbnailUrl,
          metadata: {
            category: ContentCategory.MEDIA,
            mediaType,
            path: localId,
            size: stats.size,
            mimeType: MIME_TYPES[ext]
          }
        }));
      }
    }

    return items;
  }

  /**
   * @param {string} id
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
    const item = await this.getItem(id);
    if (item?.isPlayable?.()) {
      return [item];
    }

    // Recursively get all playable items from directory
    const list = await this.getList(id);
    const playables = [];

    for (const listItem of list) {
      if (listItem.itemType === 'leaf') {
        const playable = await this.getItem(listItem.getLocalId());
        if (playable?.isPlayable?.()) {
          playables.push(playable);
        }
      } else if (listItem.itemType === 'container') {
        const children = await this.resolvePlayables(listItem.getLocalId());
        playables.push(...children);
      }
    }

    return playables;
  }

  /**
   * Search local media files
   * @param {Object} query
   * @param {string} query.text - Search text
   * @returns {Promise<Array>}
   */
  async search({ text }) {
    if (!text || text.length < 2) return [];

    const searchLower = text.toLowerCase();
    const results = [];
    const roots = await this.getRoots();

    // Search through all configured roots
    for (const root of roots) {
      const searchResults = await this._searchDirectory(root.path, searchLower);
      results.push(...searchResults);
    }

    return results;
  }

  /**
   * Recursively search a directory for matching files
   * @param {string} dirPath - Directory path relative to mediaBasePath
   * @param {string} searchText - Lowercase search text
   * @param {number} [depth=0] - Current recursion depth
   * @returns {Promise<Array>}
   */
  async _searchDirectory(dirPath, searchText, depth = 0) {
    // Limit depth to prevent infinite recursion
    if (depth > 5) return [];

    const fullPath = this.getFullPath(dirPath);
    if (!fullPath || !dirExists(fullPath)) return [];

    const entries = listEntries(fullPath);
    const results = [];

    for (const entry of entries) {
      if (entry.startsWith('.')) continue;

      const entryPath = path.join(fullPath, entry);
      const entryId = dirPath ? `${dirPath}/${entry}` : entry;
      const stats = getStats(entryPath);
      if (!stats) continue;

      const entryLower = entry.toLowerCase();

      if (stats.isDirectory()) {
        // Check if directory name matches
        if (entryLower.includes(searchText)) {
          results.push(await this.getItem(entryId));
        }
        // Recurse into subdirectories
        const subResults = await this._searchDirectory(entryId, searchText, depth + 1);
        results.push(...subResults);
      } else {
        const ext = path.extname(entry).toLowerCase();
        if (!this.isMediaFile(ext)) continue;

        const baseName = path.basename(entry, ext).toLowerCase();
        if (baseName.includes(searchText)) {
          results.push(await this.getItem(entryId));
        }
      }
    }

    return results.filter(Boolean);
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'local-media';
  }

  /**
   * Clear caches (for reindexing)
   */
  clearCache() {
    this._rootsCache = null;
    this._indexCache = null;
  }
}

export default LocalMediaAdapter;
