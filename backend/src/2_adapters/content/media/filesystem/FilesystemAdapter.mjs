// backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs
import fs from 'fs';
import path from 'path';
import { Item } from '../../../../1_domains/content/entities/Item.mjs';
import { ListableItem } from '../../../../1_domains/content/capabilities/Listable.mjs';
import { PlayableItem } from '../../../../1_domains/content/capabilities/Playable.mjs';

const MEDIA_PREFIXES = ['', 'audio', 'video', 'img'];

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
};

const AUDIO_EXTS = ['.mp3', '.m4a', '.wav', '.flac', '.ogg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mkv', '.avi'];

/**
 * Filesystem adapter for raw media files.
 * Implements IContentSource for accessing media files on the local filesystem.
 */
export class FilesystemAdapter {
  /**
   * @param {Object} config
   * @param {string} config.mediaBasePath - Base path for media files
   */
  constructor(config) {
    if (!config.mediaBasePath) {
      throw new Error('FilesystemAdapter requires mediaBasePath');
    }
    this.mediaBasePath = config.mediaBasePath;
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

      if (fs.existsSync(candidate)) {
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

        if (fs.existsSync(candidate)) {
          return { path: candidate, prefix };
        }
      }
    }

    return null;
  }

  /**
   * Get media type from extension
   * @param {string} ext
   * @returns {'audio'|'video'|'image'}
   */
  getMediaType(ext) {
    ext = ext.toLowerCase();
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    return 'image';
  }

  /**
   * @param {string} id
   * @returns {Promise<PlayableItem|ListableItem|null>}
   */
  async getItem(id) {
    const resolved = this.resolvePath(id);
    if (!resolved) return null;

    try {
      const stats = fs.statSync(resolved.path);
      if (stats.isDirectory()) {
        return new ListableItem({
          id: `filesystem:${id}`,
          source: 'filesystem',
          title: path.basename(id),
          itemType: 'container',
          childCount: fs.readdirSync(resolved.path).length
        });
      }

      const ext = path.extname(resolved.path).toLowerCase();
      const mediaType = this.getMediaType(ext);

      return new PlayableItem({
        id: `filesystem:${id}`,
        source: 'filesystem',
        title: path.basename(id, ext),
        mediaType,
        mediaUrl: `/proxy/filesystem/stream/${encodeURIComponent(id)}`,
        resumable: mediaType === 'video',
        metadata: {
          filePath: resolved.path,
          fileSize: stats.size,
          mimeType: MIME_TYPES[ext] || 'application/octet-stream'
        }
      });
    } catch (err) {
      // File was deleted or permission denied
      return null;
    }
  }

  /**
   * @param {string} id
   * @returns {Promise<ListableItem[]>}
   */
  async getList(id) {
    const resolved = this.resolvePath(id);
    if (!resolved) return [];

    try {
      const stats = fs.statSync(resolved.path);
      if (!stats.isDirectory()) return [];

      const entries = fs.readdirSync(resolved.path);
      const items = [];

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        const entryPath = path.join(resolved.path, entry);
        try {
          const entryStats = fs.statSync(entryPath);
          const entryId = id ? `${id}/${entry}` : entry;

          if (entryStats.isDirectory()) {
            items.push(new ListableItem({
              id: `filesystem:${entryId}`,
              source: 'filesystem',
              title: entry,
              itemType: 'container',
              childCount: fs.readdirSync(entryPath).length
            }));
          } else {
            const ext = path.extname(entry).toLowerCase();
            if (AUDIO_EXTS.includes(ext) || VIDEO_EXTS.includes(ext)) {
              items.push(new ListableItem({
                id: `filesystem:${entryId}`,
                source: 'filesystem',
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
    const list = await this.getList(id);
    const playables = [];

    for (const item of list) {
      if (item.itemType === 'leaf') {
        const localId = item.getLocalId();
        const playable = await this.getItem(localId);
        if (playable) playables.push(playable);
      } else if (item.itemType === 'container') {
        const localId = item.getLocalId();
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
