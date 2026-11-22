import path from 'path';
import { readBinaryFromPathAsync, writeBinaryAtomic } from '#system/utils/FileIO.mjs';

/** A cache key is a bare file name: nothing that can climb out of the cache dir. */
const KEY = /^[A-Za-z0-9_-]{1,140}\.png$/;

/**
 * FilesystemWorkImageCache — rendered learner-work pages (a printed
 * activity's solved first page) on the media mount, under
 * `<mediaBasePath>/school/beeloo-pages/<key>`. Rendering a page from its
 * solution PDF is slow, so each one is rendered once and kept.
 *
 * `read(key)` is the PNG bytes, or null when the page was never cached.
 * `write(key, bytes)` creates the directory and lands the file atomically
 * (staged beside it, then renamed), so a reader never sees half a PNG.
 * Any key that is not a plain `<safe-name>.png` throws.
 */
export class FilesystemWorkImageCache {
  #dir;

  constructor({ mediaBasePath } = {}) {
    if (typeof mediaBasePath !== 'string' || !mediaBasePath.trim()) {
      throw new Error('FilesystemWorkImageCache requires mediaBasePath');
    }
    this.#dir = path.join(mediaBasePath, 'school', 'beeloo-pages');
  }

  #pathFor(key) {
    if (typeof key !== 'string' || !KEY.test(key)) throw new Error(`invalid work image cache key: ${JSON.stringify(key)}`);
    return path.join(this.#dir, key);
  }

  async read(key) {
    const file = this.#pathFor(key);
    try {
      return await readBinaryFromPathAsync(file);
    } catch (err) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(key, bytes) {
    const file = this.#pathFor(key);
    writeBinaryAtomic(file, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  }
}

export default FilesystemWorkImageCache;
