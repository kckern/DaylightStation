import path from 'node:path';
import { IStaticImageRepository } from '#apps/static-assets/ports/IStaticImageRepository.mjs';
import { fileExists, getFileStats, readBinaryFromPath } from '#system/utils/FileIO.mjs';

const EXTENSIONS = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
const CONTENT_TYPES = Object.freeze({
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
});

export class FilesystemStaticImageRepository extends IStaticImageRepository {
  #root;

  constructor({ imgBasePath }) {
    super();
    if (!imgBasePath) throw new TypeError('FilesystemStaticImageRepository requires imgBasePath');
    this.#root = path.resolve(imgBasePath);
  }

  async getImage(kind, id) {
    const candidates = this.#logicalCandidates(kind, id);
    for (const candidate of candidates) {
      const found = this.#resolve(candidate);
      if (!found) continue;
      const stats = getFileStats(found);
      const buffer = readBinaryFromPath(found);
      return {
        identity: path.relative(this.#root, found).split(path.sep).join('/'),
        buffer,
        size: buffer.length,
        mtimeMs: stats.mtimeMs,
        contentType: CONTENT_TYPES[path.extname(found).toLowerCase()] || 'application/octet-stream',
      };
    }
    return null;
  }

  #logicalCandidates(kind, id) {
    const relative = String(id ?? '');
    if (kind === 'entropy') return [path.join('entropy', relative)];
    if (kind === 'art') return [path.join('art', relative)];
    if (kind === 'user') return [path.join('users', relative), path.join('users', 'default')];
    if (kind === 'equipment') return [path.join('equipment', relative), path.join('fitness', 'equipment', relative)];
    if (kind === 'image') return [relative];
    return [];
  }

  #resolve(relativePath) {
    const exact = path.resolve(this.#root, relativePath);
    if (exact !== this.#root && !exact.startsWith(`${this.#root}${path.sep}`)) return null;
    const candidates = [exact, ...EXTENSIONS.map((extension) => `${exact}.${extension}`)];
    return candidates.find((candidate) => {
      if (!fileExists(candidate)) return false;
      try { return getFileStats(candidate).isFile(); } catch { return false; }
    }) || null;
  }
}
