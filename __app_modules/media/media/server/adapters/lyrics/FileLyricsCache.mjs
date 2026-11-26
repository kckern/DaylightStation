import path from 'path';
import { readTextFromPathAsync, writeFileAtomic } from '#system/utils/FileIO.mjs';

/**
 * Looked-up lyrics on disk, one JSON file per track:
 * `<dataDir>/system/cache/lyrics/<source>/<localId>.json` holding
 * `{ at: epochMs, value: <parsed lyrics> | null }`. A null value is a miss
 * remembered, so a song with no lyrics anywhere is not asked about on every play.
 * Losing the directory loses nothing but time.
 */
export class FileLyricsCache {
  #dir;

  constructor({ dir }) {
    if (!dir) throw new Error('FileLyricsCache requires dir');
    this.#dir = dir;
  }

  #file(source, localId) {
    // No separators and no leading dot, so neither part can climb out of the directory.
    const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 120) || '_';
    return path.join(this.#dir, safe(source), `${safe(localId)}.json`);
  }

  /** @returns {Promise<{at: number, value: object|null}|undefined>} undefined when nothing is cached */
  async get(source, localId) {
    try {
      const entry = JSON.parse(await readTextFromPathAsync(this.#file(source, localId)));
      if (entry && typeof entry.at === 'number' && 'value' in entry) return entry;
    } catch { /* missing or unreadable: not cached */ }
    return undefined;
  }

  async set(source, localId, value, at) {
    // Staged and renamed into place: a reader never sees half a file.
    writeFileAtomic(this.#file(source, localId), JSON.stringify({ at, value }));
  }
}

export default FileLyricsCache;
