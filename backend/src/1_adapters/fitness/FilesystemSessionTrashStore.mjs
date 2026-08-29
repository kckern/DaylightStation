import path from 'node:path';
import { ISessionTrashStore } from '#apps/fitness/ports/ISessionTrashStore.mjs';
import {
  buildContainedPath,
  deleteDirAsync,
  fileExistsAsync,
  getFileStatsAsync,
  readDirectoryAsync,
} from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/** Filesystem persistence for the bounded fitness-session trash tree. */
export class FilesystemSessionTrashStore extends ISessionTrashStore {
  #trashDir;

  constructor({ mediaDir, trashDir = mediaDir && path.join(mediaDir, 'fitness', '_trash') } = {}) {
    super();
    if (!trashDir) {
      throw new InfrastructureError('FilesystemSessionTrashStore requires trashDir', { code: 'MISSING_DEPENDENCY' });
    }
    this.#trashDir = path.resolve(trashDir);
  }

  async listRetentionBatches() {
    if (!(await fileExistsAsync(this.#trashDir))) return null;
    const dates = await subdirectories(this.#trashDir);
    return Promise.all(dates.map(async (date) => {
      const dateDir = this.#contained(date);
      const ids = await subdirectories(dateDir);
      const entries = await Promise.all(ids.map(async (id) => {
        try {
          const entryDir = this.#contained(date, id);
          return { id, trashedAt: (await getFileStatsAsync(entryDir)).mtimeMs || 0 };
        } catch (error) {
          return { id, error };
        }
      }));
      return { date, entries };
    }));
  }

  async permanentlyDelete({ date, id }) {
    await deleteDirAsync(this.#contained(date, id), { force: true });
  }

  async pruneBatchIfEmpty(date) {
    const dateDir = this.#contained(date);
    if ((await subdirectories(dateDir)).length > 0) return false;
    await deleteDirAsync(dateDir, { force: true });
    return true;
  }

  #contained(...segments) {
    if (segments.some(segment => !/^[A-Za-z0-9._-]+$/.test(String(segment)))) {
      throw new InfrastructureError('invalid trash entry key', { code: 'INVALID_TRASH_KEY' });
    }
    const candidate = buildContainedPath(this.#trashDir, segments.join('/'));
    if (!candidate) throw new InfrastructureError('trash entry escaped root', { code: 'INVALID_TRASH_KEY' });
    return candidate;
  }
}

async function subdirectories(directory) {
  try {
    return (await readDirectoryAsync(directory, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}
