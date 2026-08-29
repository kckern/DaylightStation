import path from 'node:path';
import {
  createReadStream,
  fileExists,
  getFileStats,
  writeBinaryAsync,
} from '#system/utils/FileIO.mjs';
import { IProxyAssetCache } from '#apps/proxy/ports/IProxyAssetCache.mjs';

function resource(filePath, mimeType) {
  const stat = getFileStats(filePath);
  return Object.freeze({
    size: stat.size,
    mimeType,
    open(options) { return createReadStream(filePath, options); },
  });
}

/** Filesystem cache for generated proxy assets. */
export class FilesystemProxyAssetCache extends IProxyAssetCache {
  #mediaBasePath;

  constructor({ mediaBasePath = null } = {}) {
    super();
    this.#mediaBasePath = mediaBasePath;
  }

  async findComposite({ bookId, page }) {
    const filePath = this.#compositePath(bookId, page);
    return filePath && fileExists(filePath) ? resource(filePath, 'image/jpeg') : null;
  }

  async storeComposite({ bookId, page }, artifact) {
    const filePath = this.#compositePath(bookId, page);
    if (filePath) await writeBinaryAsync(filePath, artifact);
  }

  async findThumbnail(thumbnailId) {
    const filePath = this.#thumbnailPath(thumbnailId);
    if (!filePath || !fileExists(filePath)) return null;
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
    return resource(filePath, mimeType);
  }

  async storeThumbnail(thumbnailId, artifact) {
    const filePath = this.#thumbnailPath(thumbnailId);
    if (filePath) await writeBinaryAsync(filePath, artifact);
  }

  #compositePath(id, page) {
    return this.#mediaBasePath
      ? path.join(this.#mediaBasePath, 'img', 'komga', 'hero', `${id}-${page}.jpg`)
      : null;
  }

  #thumbnailPath(thumbnailId) {
    return this.#mediaBasePath
      ? path.join(this.#mediaBasePath, 'img', 'retroarch', 'thumbs', thumbnailId)
      : null;
  }
}

export default FilesystemProxyAssetCache;
