import path from 'node:path';
import { getStats } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';
import { parseMediaRef } from '#domains/school/cardLadder/index.mjs';

const MIME = Object.freeze({
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
});
const MEDIA_PREFIX = 'media:';

/**
 * Read-only, traversal-safe resolution of authored School flashcard assets.
 * Two named roots: bare ids resolve under the content asset dir, `media:` ids
 * under `<mediaDir>/school` (generated word packages) — the `media:` prefix
 * is parsed and traversal-refused by the card-ladder domain's parseMediaRef,
 * not reimplemented here. A 0-byte file is a placeholder, i.e. missing: the
 * player renders around it.
 */
export class SchoolFlashcardAssetRepository {
  #root; #mediaRoot;
  constructor({ rootDir, mediaRootDir = null } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('SchoolFlashcardAssetRepository requires rootDir');
    this.#root = path.resolve(rootDir);
    this.#mediaRoot = typeof mediaRootDir === 'string' && mediaRootDir.trim() ? path.resolve(mediaRootDir) : null;
  }

  #resolve(assetId) {
    if (typeof assetId !== 'string' || !assetId.trim() || assetId.includes('\0')) return null;
    if (assetId.startsWith(MEDIA_PREFIX)) {
      if (!this.#mediaRoot) return null;
      const parsed = parseMediaRef(assetId);
      if (!parsed.ok) return null;
      return this.#existingFile(path.resolve(this.#mediaRoot, parsed.path), this.#mediaRoot);
    }
    return this.#existingFile(path.resolve(this.#root, assetId), this.#root);
  }

  #existingFile(file, root) {
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
    const stats = getStats(file);
    return stats?.isFile() && stats.size > 0 ? file : null;
  }

  exists(assetId) { return this.#resolve(assetId) !== null; }
  get(assetId) {
    const file = this.#resolve(assetId);
    if (!file) return null;
    const contentType = MIME[path.extname(file).toLowerCase()];
    return contentType ? { resource: createLocalFileResource(file, { mimeType: contentType }), contentType } : null;
  }
}
export default SchoolFlashcardAssetRepository;
