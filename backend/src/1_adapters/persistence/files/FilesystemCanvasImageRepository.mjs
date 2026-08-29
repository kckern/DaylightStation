import path from 'node:path';
import { ICanvasImageRepository } from '#apps/canvas/ports/ICanvasImageRepository.mjs';
import { fileExists, getFileStats } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const CONTENT_TYPES = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

export class FilesystemCanvasImageRepository extends ICanvasImageRepository {
  #root;

  constructor({ rootDir }) {
    super();
    if (!rootDir) throw new TypeError('FilesystemCanvasImageRepository requires rootDir');
    this.#root = path.resolve(rootDir);
  }

  async getImageResource(imageId) {
    const candidate = path.resolve(this.#root, String(imageId ?? ''));
    if (candidate !== this.#root && !candidate.startsWith(`${this.#root}${path.sep}`)) {
      const error = new Error('Access denied');
      error.code = 'ACCESS_DENIED';
      throw error;
    }
    if (candidate === this.#root || !fileExists(candidate)) return null;
    const stats = getFileStats(candidate);
    if (!stats.isFile()) return null;
    return createLocalFileResource(candidate, {
      mimeType: CONTENT_TYPES[path.extname(candidate).toLowerCase()] || 'application/octet-stream',
    });
  }
}
