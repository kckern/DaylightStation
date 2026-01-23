// backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs
import path from 'path';
import { parseFile } from 'music-metadata';
import { Item } from '../../../../1_domains/content/entities/Item.mjs';
import { ListableItem } from '../../../../1_domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '../../../../1_domains/content/capabilities/Playable.mjs';
import {
  fileExists,
  dirExists,
  loadYamlFromPath,
  resolveYamlPath,
  listEntries,
  getStats,
  isFile
} from '../../../../0_infrastructure/utils/FileIO.mjs';

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];

const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_COVER_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Filesystem adapter for raw media files.
 * Implements IContentSource for accessing media files on the local filesystem.
 * Supports watch state integration for resume position tracking.
 */
export class FilesystemAdapter {
  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for media files
   * @param {string} [config.historyPath] - Path to media_memory directory for watch state
   * @param {string} [config.householdId] - Household ID for scoped watch state
   * @param {string} [config.householdsBasePath] - Base path for household data directories
   */
  constructor(config) {
    if (!config.mediaBasePath) {
      throw new Error('FilesystemAdapter requires mediaBasePath');
    }
    this.mediaBasePath = config.mediaBasePath;
    this.historyPath = config.historyPath || null;
    this.householdId = config.householdId || null;
    this.householdsBasePath = config.householdsBasePath || null;
    this._watchStateCache = null;
  }

  /**
   * Load watch state from media_memory YAML file
   * Tries household-specific path first, then falls back to global path.
   * @returns {Object} Watch state map { mediaKey: { percent, seconds, playhead, mediaDuration } }
   * @private
   */
  _loadWatchState() {
    if (!this.historyPath) return {};
    if (this._watchStateCache) return this._watchStateCache;

    try {
      // Try household-specific path first
      if (this.householdId && this.householdsBasePath) {
        const householdPath = path.join(
          this.householdsBasePath,
          this.householdId,
          'history/media_memory/media.yml'
        );
        const basePath = householdPath.replace(/\.yml$/, '');
        const resolvedPath = resolveYamlPath(basePath);
        if (resolvedPath) {
          this._watchStateCache = loadYamlFromPath(resolvedPath) || {};
          return this._watchStateCache;
        }
      }

      // Fall back to global path
      const filePath = path.join(this.historyPath, 'media.yml');
      const basePath = filePath.replace(/\.yml$/, '');
      const resolvedPath = resolveYamlPath(basePath);
      if (!resolvedPath) return {};
      this._watchStateCache = loadYamlFromPath(resolvedPath) || {};
      return this._watchStateCache;
    } catch (err) {
      return {};
    }
  }

  /**
   * Get watch state for a specific media key
   * @param {string} mediaKey - Media key (file path)
   * @returns {Object|null} Watch state { percent, seconds, playhead, mediaDuration }
   * @private
   */
  _getWatchState(mediaKey) {
    const watchState = this._loadWatchState();
    // Try both with and without filesystem: prefix
    return watchState[mediaKey] || watchState[`filesystem:${mediaKey}`] || null;
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
    return 'filesystem';
  }

  get prefixes() {
    return [
      { prefix: 'media' },
      { prefix: 'file' },
      { prefix: 'fs' }
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
   * @param {string} id - Compound ID like "filesystem:path/to/file.mp3"
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    // Strip source prefix if present
    const localId = id.replace(/^filesystem:/, '');
    const resolved = this.resolvePath(localId);
    if (!resolved) return null;

    try {
      const stats = getStats(resolved.path);
      if (!stats) return null;

      if (stats.isDirectory()) {
        const entries = listEntries(resolved.path);
        return new ListableItem({
          id: `filesystem:${localId}`,
          source: 'filesystem',
          localId,
          title: path.basename(localId),
          itemType: 'container',
          childCount: entries.length
        });
      }

      const ext = path.extname(resolved.path).toLowerCase();
      const mediaType = this.getMediaType(ext);

      // Load watch state for resume position
      const watchState = this._getWatchState(localId);
      const resumePosition = watchState?.playhead || watchState?.seconds || null;
      const duration = watchState?.mediaDuration || null;

      // Parse ID3 tags for audio files
      let audioMetadata = {};
      if (mediaType === 'audio') {
        audioMetadata = await this._parseAudioMetadata(resolved.path);
      }

      return new PlayableItem({
        id: `filesystem:${localId}`,
        source: 'filesystem',
        localId,
        title: path.basename(localId, ext),
        mediaType,
        mediaUrl: `/proxy/filesystem/stream/${encodeURIComponent(localId)}`,
        duration,
        resumable: mediaType === 'video',
        resumePosition,
        metadata: {
          ...audioMetadata,
          filePath: resolved.path,
          fileSize: stats.size,
          mimeType: MIME_TYPES[ext] || 'application/octet-stream',
          // Include watch state fields in metadata for compatibility
          percent: watchState?.percent || null,
          playhead: resumePosition,
          watchTime: watchState?.watchTime || null
        }
      });
    } catch (err) {
      // File was deleted or permission denied
      return null;
    }
  }

  /**
   * @param {string} id - Compound ID like "filesystem:path/to/dir"
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    // Strip source prefix if present
    const localId = id.replace(/^filesystem:/, '');
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

          const entryId = id ? `${id}/${entry}` : entry;

          if (entryStats.isDirectory()) {
            const childEntries = listEntries(entryPath);
            items.push(new ListableItem({
              id: `filesystem:${entryId}`,
              source: 'filesystem',
              localId: entryId,
              title: entry,
              itemType: 'container',
              childCount: childEntries.length
            }));
          } else {
            const ext = path.extname(entry).toLowerCase();
            if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
              items.push(new ListableItem({
                id: `filesystem:${entryId}`,
                source: 'filesystem',
                localId: entryId,
                title: path.basename(entry, ext),
                itemType: 'leaf'
              }));
            }
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
   * @returns {Promise<PlayableItem[]>}
   */
  async resolvePlayables(id) {
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
        const children = await this.resolvePlayables(localId);
        playables.push(...children);
      }
    }

    return playables;
  }

  /**
   * @param {string} id
   * @returns {Promise<string>}
   */
  async getStoragePath(id) {
    return 'media';
  }
}
