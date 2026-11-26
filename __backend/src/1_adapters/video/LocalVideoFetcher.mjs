/**
 * LocalVideoFetcher — the app's own fetcher, used when the fetch service is not
 * configured or cannot fetch: yt-dlp in the app container (an injected
 * `downloadOne`, the media module's YtDlpAdapter), into a temp folder that is
 * NOT the media mount (that mount is a synced folder). The default folder is in
 * the container itself, so it does not survive a restart of the app: a share
 * fetched here is gone after one, and the screen lets go.
 *
 *   fetch(url, { name, maxHeight, onProgress, signal }) -> { kind, title, duration, media } | { kind: 'failed', error, reason }
 *   stored(name) -> { title, duration, media } | null
 *   cancel(name)
 *   sweep({ maxAgeMs, keep })
 *
 * Reference: __docs/reference/core/share.md
 */
import path from 'node:path';
import { ensureDir, listFiles, getFileStats, deleteFile, fileExists, readFile, writeFile } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const NAME = /^s[0-9a-f]{12}$/;
const JOB_FILE = /^(s[0-9a-f]{12})(\..+)?$/;

export class LocalVideoFetcher {
  #downloader; #dir; #logger; #clock; #running = new Map();

  /**
   * @param {object} deps
   * @param {{ downloadOne(url, options): Promise<object> }} deps.downloader
   * @param {string} deps.dir - temp folder outside any synced mount
   */
  constructor({ downloader, dir, logger = console, clock = Date.now }) {
    if (!downloader?.downloadOne || !dir) throw new Error('LocalVideoFetcher requires downloader and dir');
    this.#downloader = downloader;
    this.#dir = dir;
    this.#logger = logger;
    this.#clock = clock;
  }

  get name() { return 'local'; }

  #file(name) { return path.join(this.#dir, `${name}.mp4`); }
  #meta(name) { return path.join(this.#dir, `${name}.json`); }
  #media(name) { return createLocalFileResource(this.#file(name), { mimeType: 'video/mp4' }); }

  async fetch(url, { name, maxHeight, onProgress, signal } = {}) {
    if (!NAME.test(String(name))) throw new Error('bad fetch name');
    ensureDir(this.#dir);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
    this.#running.set(name, ctrl);
    try {
      const result = await this.#downloader.downloadOne(url, { outputPath: this.#file(name), maxHeight, onProgress, signal: ctrl.signal });
      if (result?.kind !== 'downloaded') {
        return { kind: 'failed', error: result?.error || 'failed', reason: result?.reason || (result?.error === 'cancelled' ? 'cancelled' : 'error') };
      }
      writeFile(this.#meta(name), JSON.stringify({ title: result.title ?? null, duration: result.duration ?? null }));
      return { kind: 'downloaded', title: result.title ?? null, duration: result.duration ?? null, media: this.#media(name) };
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
      this.#running.delete(name);
    }
  }

  async stored(name) {
    if (!NAME.test(String(name)) || !fileExists(this.#file(name))) return null;
    let meta = {};
    try { meta = JSON.parse(readFile(this.#meta(name)) || '{}'); } catch { meta = {}; }
    return { title: meta.title ?? null, duration: meta.duration ?? null, media: this.#media(name) };
  }

  async cancel(name) {
    this.#running.get(name)?.abort();
    for (const f of [this.#file(name), this.#meta(name)]) deleteFile(f);
  }

  /** Delete files older than `maxAgeMs`, except those being fetched now. @returns {number} */
  sweep({ maxAgeMs }) {
    let deleted = 0;
    const now = this.#clock();
    for (const entry of listFiles(this.#dir)) {
      const m = JOB_FILE.exec(entry);
      if (!m || this.#running.has(m[1])) continue;
      const file = path.join(this.#dir, entry);
      try {
        if (now - getFileStats(file).mtimeMs >= maxAgeMs && deleteFile(file)) deleted += 1;
      } catch (error) {
        this.#logger.warn?.('share.temp.sweep-failed', { file: entry, error: error.message });
      }
    }
    if (deleted) this.#logger.info?.('share.temp.swept', { deleted });
    return deleted;
  }
}

export default LocalVideoFetcher;
