import path from 'node:path';
import { ensureDir, getStats, listFiles, writeBinary } from '#system/utils/FileIO.mjs';
import { IAdminImageStore } from '#apps/admin/ports/IAdminImageStore.mjs';

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

export class AdminImageFileStore extends IAdminImageStore {
  #directory;
  constructor({ mediaPath } = {}) {
    super();
    if (!mediaPath) throw new Error('AdminImageFileStore requires mediaPath');
    this.#directory = path.join(mediaPath, 'img', 'lists');
  }
  list() {
    let files;
    try { files = listFiles(this.#directory); } catch { return []; }
    return files.filter((file) => ALLOWED_EXTENSIONS.has(path.extname(file).slice(1).toLowerCase()))
      .map((file) => {
        const stats = getStats(path.join(this.#directory, file));
        return {
          filename: file,
          path: `/media/img/lists/${file}`,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
  }
  save({ id, extension, buffer }) {
    const filename = `${id}.${extension}`;
    ensureDir(this.#directory);
    writeBinary(path.join(this.#directory, filename), buffer);
    return { filename, path: `/media/img/lists/${filename}` };
  }
}
