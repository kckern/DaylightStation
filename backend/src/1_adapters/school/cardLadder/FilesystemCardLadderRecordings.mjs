import path from 'node:path';
import { dirExists, listEntries, writeBinary } from '#system/utils/FileIO.mjs';
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
  #root;
  constructor({ rootDir } = {}) {
    if (typeof rootDir !== 'string' || !rootDir.trim()) throw new Error('FilesystemCardLadderRecordings requires rootDir');
    this.#root = path.resolve(rootDir);
  }
  #dir(pkg, learnerId, day, wordId) {
    if (typeof pkg !== 'string' || !ID.test(pkg) || !ID.test(String(learnerId)) || !DAY.test(String(day)) || !ID.test(String(wordId))) return null;
    return path.join(this.#root, pkg, learnerId, day);
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
  latest({ package: pkg, learnerId, day, wordId }) {
    const dir = this.#dir(pkg, learnerId, day, wordId);
    if (!dir) return null;
    const last = this.#takes(dir, wordId).at(-1);
    if (!last || !MIME[last.ext]) return null;
    return { resource: createLocalFileResource(path.join(dir, last.name), { mimeType: MIME[last.ext] }), contentType: MIME[last.ext] };
  }
}
export default FilesystemCardLadderRecordings;
