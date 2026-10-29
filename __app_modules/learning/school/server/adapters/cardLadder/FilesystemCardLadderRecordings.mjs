import path from 'node:path';
import { copyDirectoryOnce, dirExists, listEntries, writeBinary } from '#system/utils/FileIO.mjs';
import { createLocalFileResource } from '#system/http/streamFile.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EXT = /^(webm|ogg|m4a|mp4|wav)$/;
const MIME = Object.freeze({ webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav' });

/**
 * `{rootDir}/{package}/{learnerId}/{studyDay}/{wordId}-{n}.{ext}` — a
 * learner's spoken takes, per word package (word ids are unique only within a
 * package). Presentation and review only: the credit is the status history.
 */
export class FilesystemCardLadderRecordings {
  #root; #legacyRoot;
  /**
   * `legacyRootDir` is the pre-rename (2026-09-23) `recordings/word-ladder`.
   * The first time a learner's takes for a package are touched and only the
   * old `{package}/{learnerId}` directory exists, it is COPIED here; the old
   * one is never deleted or written again.
   */
  constructor({ rootDir, legacyRootDir = null } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('FilesystemCardLadderRecordings requires rootDir');
    this.#root = path.resolve(rootDir);
    this.#legacyRoot = typeof legacyRootDir === 'string' && legacyRootDir.trim() ? path.resolve(legacyRootDir) : null;
  }
  #dayDir(pkg, learnerId, day) {
    if (typeof pkg !== 'string' || !ID.test(pkg) || !ID.test(String(learnerId)) || !DAY.test(String(day))) return null;
    const learnerDir = path.join(this.#root, pkg, learnerId);
    if (this.#legacyRoot && !dirExists(learnerDir)) copyDirectoryOnce(path.join(this.#legacyRoot, pkg, learnerId), learnerDir);
    return path.join(learnerDir, day);
  }
  #dir(pkg, learnerId, day, wordId) {
    return ID.test(String(wordId)) ? this.#dayDir(pkg, learnerId, day) : null;
  }
  #takes(dir, wordId) {
    if (!dirExists(dir)) return [];
    const pattern = new RegExp(`^${wordId}-(\\d+)\\.([a-z0-9]+)$`);
    return listEntries(dir)
      .map((name) => { const match = pattern.exec(name); return match ? { name, n: Number(match[1]), ext: match[2] } : null; })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n);
  }
  save({
    package: pkg, learnerId, day, wordId, buffer, ext = 'webm',
  }) {
    const dir = this.#dir(pkg, learnerId, day, wordId);
    if (!dir || !EXT.test(String(ext))) throw new Error('invalid recording address');
    const take = (this.#takes(dir, wordId).at(-1)?.n ?? 0) + 1;
    const file = path.join(dir, `${wordId}-${take}.${ext}`);
    writeBinary(file, buffer);
    return { take, file };
  }
  /** Every take kept on `day`, by word then take number: `[{wordId, take, ext}]`. */
  list({ package: pkg, learnerId, day }) {
    const dir = this.#dayDir(pkg, learnerId, day);
    if (!dir || !dirExists(dir)) return [];
    return listEntries(dir)
      .map((name) => /^([a-z0-9][a-z0-9_-]{0,63})-(\d+)\.([a-z0-9]+)$/i.exec(name))
      .filter((match) => match && MIME[match[3]])
      .map((match) => ({ wordId: match[1], take: Number(match[2]), ext: match[3] }))
      .sort((a, b) => a.wordId.localeCompare(b.wordId) || a.take - b.take);
  }
  /** One take's audio by its number, or null. */
  open({ package: pkg, learnerId, day, wordId, take }) {
    if (!Number.isInteger(take) || take < 1) return null;
    const dir = this.#dir(pkg, learnerId, day, wordId);
    if (!dir) return null;
    const found = this.#takes(dir, wordId).find((entry) => entry.n === take);
    if (!found || !MIME[found.ext]) return null;
    return { resource: createLocalFileResource(path.join(dir, found.name), { mimeType: MIME[found.ext] }), contentType: MIME[found.ext] };
  }
  latest({ package: pkg, learnerId, day, wordId }) {
    const dir = this.#dir(pkg, learnerId, day, wordId);
    if (!dir) return null;
    const last = this.#takes(dir, wordId).at(-1);
    if (!last || !MIME[last.ext]) return null;
    return { resource: createLocalFileResource(path.join(dir, last.name), { mimeType: MIME[last.ext] }), contentType: MIME[last.ext] };
  }
}
export default FilesystemCardLadderRecordings;
