import path from 'path';
import { fileExists, readBinary, writeBinaryAtomic } from '#system/utils/FileIO.mjs';

const LEARNER_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const EXT_BY_TYPE = [[/ogg/, 'ogg'], [/mp4|m4a/, 'm4a']];
const MIME_BY_EXT = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

/** Debrief voice takes on the media mount: `<root>/<learnerId>/<studyDay>-<ms>.<ext>`. */
export class FilesystemProgramAudio {
  #root; #clock;
  constructor({ rootDir, clock = () => Date.now() }) { this.#root = rootDir; this.#clock = clock; }

  /** @returns {Promise<string>} ref `<learnerId>/<file>` */
  async save({ learnerId, studyDay, buffer, mimeType }) {
    if (!LEARNER_RE.test(String(learnerId))) throw new Error('invalid learnerId');
    const ext = (EXT_BY_TYPE.find(([re]) => re.test(mimeType ?? '')) ?? [null, 'webm'])[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDay)) throw new Error('invalid studyDay');
    const stem = `${studyDay}-${this.#clock()}`;
    let name = `${stem}.${ext}`;
    for (let n = 2; fileExists(path.join(this.#root, learnerId, name)); n += 1) name = `${stem}-${n}.${ext}`;
    writeBinaryAtomic(path.join(this.#root, learnerId, name), buffer); // creates the directory
    return `${learnerId}/${name}`;
  }

  /** @returns {{buffer: Buffer, mimeType: string}|null} */
  read(learnerId, file) {
    if (!LEARNER_RE.test(String(learnerId)) || !/^\d{4}-\d{2}-\d{2}-\d+(?:-\d+)?\.(webm|ogg|m4a)$/.test(String(file))) return null;
    const full = path.join(this.#root, learnerId, file);
    if (!fileExists(full)) return null;
    return { buffer: readBinary(full), mimeType: MIME_BY_EXT[path.extname(file).slice(1)] ?? 'application/octet-stream' };
  }
}
