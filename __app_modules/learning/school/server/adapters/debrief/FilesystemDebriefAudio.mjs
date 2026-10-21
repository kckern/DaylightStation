import path from 'path';
import { fileExists, readBinary, writeBinaryAtomic } from '#system/utils/FileIO.mjs';

const EXT_BY_TYPE = [[/ogg/, 'ogg'], [/mp4|m4a/, 'm4a']];
const MIME_BY_EXT = { webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4' };

/** Debrief voice takes on the media mount: `<root>/<learnerId>/<studyDay>-<ms>.<ext>`. */
export class FilesystemDebriefAudio {
  #root; #clock;
  constructor({ rootDir, clock = () => Date.now() }) { this.#root = rootDir; this.#clock = clock; }

  /** @returns {Promise<string>} ref `<learnerId>/<file>` */
  async save({ learnerId, studyDay, buffer, mimeType }) {
    const ext = (EXT_BY_TYPE.find(([re]) => re.test(mimeType ?? '')) ?? [null, 'webm'])[1];
    const name = `${studyDay}-${this.#clock()}.${ext}`;
    writeBinaryAtomic(path.join(this.#root, learnerId, name), buffer); // creates the directory
    return `${learnerId}/${name}`;
  }

  /** @returns {{buffer: Buffer, mimeType: string}|null} */
  read(learnerId, file) {
    const full = path.join(this.#root, learnerId, file);
    if (!fileExists(full)) return null;
    return { buffer: readBinary(full), mimeType: MIME_BY_EXT[path.extname(file).slice(1)] ?? 'application/octet-stream' };
  }
}
