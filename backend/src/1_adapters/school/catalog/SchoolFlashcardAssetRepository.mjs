import path from 'node:path';
import { fileExists } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const MIME = Object.freeze({
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
});

/** Read-only, traversal-safe resolution of authored School flashcard assets. */
export class SchoolFlashcardAssetRepository {
  #root;
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('SchoolFlashcardAssetRepository requires rootDir');
    this.#root = path.resolve(rootDir);
  }
  get(assetId) {
    if (typeof assetId !== 'string' || !assetId.trim() || assetId.includes('\0')) return null;
    const file = path.resolve(this.#root, assetId);
    if (file !== this.#root && !file.startsWith(`${this.#root}${path.sep}`)) return null;
    if (!fileExists(file)) return null;
    const contentType = MIME[path.extname(file).toLowerCase()];
    return contentType ? { resource: createLocalFileResource(file, { mimeType: contentType }), contentType } : null;
  }
}
export default SchoolFlashcardAssetRepository;
