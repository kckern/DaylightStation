import crypto from 'node:crypto';
import path from 'node:path';
import {
  createReadStream,
  ensureDir,
  fileExists,
  getFileStats,
  resolveRealPath,
} from '#system/utils/FileIO.mjs';
import { ILocalMediaRepository } from '#apps/media/ports/ILocalMediaRepository.mjs';

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
  '.webp': 'image/webp',
};

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function mediaResource(filePath, mimeType, stat = getFileStats(filePath)) {
  return Object.freeze({
    size: stat.size,
    mimeType,
    open(options) {
      return createReadStream(filePath, options);
    },
  });
}

/** Filesystem implementation of the local-media repository port. */
export class FilesystemLocalMediaRepository extends ILocalMediaRepository {
  #mediaBasePath;
  #thumbnailCacheDir;
  #thumbnailGenerator;
  #logger;

  constructor({ mediaBasePath, cacheBasePath, thumbnailGenerator, logger = console } = {}) {
    super();
    if (!mediaBasePath) throw new Error('FilesystemLocalMediaRepository requires mediaBasePath');
    if (!cacheBasePath) throw new Error('FilesystemLocalMediaRepository requires cacheBasePath');
    if (!thumbnailGenerator || typeof thumbnailGenerator.generate !== 'function') {
      throw new Error('FilesystemLocalMediaRepository requires thumbnailGenerator');
    }

    this.#mediaBasePath = mediaBasePath;
    this.#thumbnailCacheDir = path.join(cacheBasePath, 'thumbnails');
    this.#thumbnailGenerator = thumbnailGenerator;
    this.#logger = logger;
    ensureDir(this.#thumbnailCacheDir);
  }

  #resolve(mediaId) {
    const safePath = path.normalize(mediaId).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(this.#mediaBasePath, safePath);
    const resolvedBase = path.resolve(this.#mediaBasePath);
    const resolvedFull = path.resolve(fullPath);

    if (resolvedFull !== resolvedBase && !resolvedFull.startsWith(`${resolvedBase}${path.sep}`)) return { kind: 'forbidden' };
    if (!fileExists(fullPath)) return { kind: 'not_found' };
    const realBase = resolveRealPath(resolvedBase) || resolvedBase;
    const realFile = resolveRealPath(fullPath);
    if (!realFile || (realFile !== realBase && !realFile.startsWith(`${realBase}${path.sep}`))) {
      return { kind: 'forbidden' };
    }
    return { kind: 'found', fullPath: realFile, stat: getFileStats(realFile) };
  }

  async getMediaResource(mediaId) {
    const resolved = this.#resolve(mediaId);
    if (resolved.kind !== 'found') return resolved;
    if (!resolved.stat.isFile()) return { kind: 'not_file' };

    const extension = path.extname(resolved.fullPath).toLowerCase();
    return {
      kind: 'found',
      resource: mediaResource(
        resolved.fullPath,
        MIME_TYPES[extension] || 'application/octet-stream',
        resolved.stat,
      ),
    };
  }

  async getThumbnailResource(mediaId) {
    const resolved = this.#resolve(mediaId);
    if (resolved.kind !== 'found') return resolved;

    const extension = path.extname(resolved.fullPath).toLowerCase();
    const cacheKey = crypto
      .createHash('md5')
      .update(`${resolved.fullPath}:${resolved.stat.mtimeMs}`)
      .digest('hex');
    const thumbnailPath = path.join(this.#thumbnailCacheDir, `${cacheKey}.jpg`);

    if (fileExists(thumbnailPath)) {
      return { kind: 'found', resource: mediaResource(thumbnailPath, 'image/jpeg') };
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
      return {
        kind: 'found',
        resource: mediaResource(
          resolved.fullPath,
          MIME_TYPES[extension] || 'image/jpeg',
          resolved.stat,
        ),
      };
    }

    if (!VIDEO_EXTENSIONS.has(extension)) return { kind: 'unsupported' };

    try {
      await this.#thumbnailGenerator.generate(resolved.fullPath, thumbnailPath);
      if (fileExists(thumbnailPath)) {
        return { kind: 'found', resource: mediaResource(thumbnailPath, 'image/jpeg') };
      }
    } catch (error) {
      this.#logger.warn?.('local.thumbnail.ffmpeg.failed', {
        mediaId,
        error: error.message,
      });
    }

    return { kind: 'generation_failed' };
  }
}

export default FilesystemLocalMediaRepository;
