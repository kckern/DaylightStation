/**
 * ShareTempStore — the temp folder on the media mount where shared videos are
 * fetched (`<media>/tmp/share/<jobId>.mp4`), and its sweep. Nothing here is
 * kept: a file older than `maxAgeMs` is deleted unless its job is still live.
 *
 * Reference: __docs/reference/core/share.md
 */
import path from 'node:path';
import { ensureDir, listFiles, getFileStats, deleteFile } from '#system/utils/FileIO.mjs';

/** The media-relative folder: the `files` source serves it at /api/v1/proxy/media/stream/<rel>. */
export const SHARE_TEMP_REL = 'tmp/share';
const JOB_FILE = /^(s[0-9a-f]{12})(\..+)?$/;

export class ShareTempStore {
  #dir; #logger; #clock;

  constructor({ mediaDir, logger = console, clock = Date.now }) {
    if (!mediaDir) throw new Error('ShareTempStore requires mediaDir');
    this.#dir = path.join(mediaDir, SHARE_TEMP_REL);
    this.#logger = logger;
    this.#clock = clock;
  }

  /** The mp4 a job is fetched to. */
  filePathFor(jobId) {
    if (!/^s[0-9a-f]{12}$/.test(String(jobId))) throw new Error('bad share job id');
    ensureDir(this.#dir);
    return path.join(this.#dir, `${jobId}.mp4`);
  }

  /** The media-relative path the stream route serves a job's file at. */
  relativePathFor(jobId) { return `${SHARE_TEMP_REL}/${jobId}.mp4`; }

  /**
   * Delete fetched files (and stray stream parts) older than `maxAgeMs`,
   * except those of jobs in `keepJobIds`. Only `s<12 hex>…` names are touched.
   * @returns {number} files deleted
   */
  sweep({ maxAgeMs, keepJobIds = new Set() }) {
    let deleted = 0;
    const now = this.#clock();
    for (const name of listFiles(this.#dir)) {
      const match = JOB_FILE.exec(name);
      if (!match || keepJobIds.has(match[1])) continue;
      const file = path.join(this.#dir, name);
      try {
        if (now - getFileStats(file).mtimeMs < maxAgeMs) continue;
        if (deleteFile(file)) deleted += 1;
      } catch (error) {
        this.#logger.warn?.('share.temp.sweep-failed', { file: name, error: error.message });
      }
    }
    if (deleted) this.#logger.info?.('share.temp.swept', { deleted });
    return deleted;
  }
}

export default ShareTempStore;
