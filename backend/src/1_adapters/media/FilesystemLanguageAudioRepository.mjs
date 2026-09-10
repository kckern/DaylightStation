import {
  buildContainedPath,
  createReadStream,
  fileExists,
  getFileStats,
} from '#system/utils/FileIO.mjs';
import { ILanguageAudioRepository } from '#apps/school/ports/ILanguageAudioRepository.mjs';

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const LANG_RE = /^[A-Za-z]{2,8}$/;
const EXT_RE = /^[a-z0-9]{2,5}$/i;
// A cue is one file in one flat folder: a bare name with an audio extension.
// No separators, so a configured value can never walk out of `_ux/`.
const CUE_FILE_RE = /^[a-z0-9][a-z0-9_-]*\.(mp3|ogg|wav|m4a|webm)$/i;
const CONTENT_TYPES = Object.freeze({
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
});

const padSeq = (seq) => String(Number(seq)).padStart(4, '0');

function foundResource(filePath, extension) {
  if (!filePath || !fileExists(filePath)) return { kind: 'not-found' };
  const stats = getFileStats(filePath);
  return {
    kind: 'found',
    resource: Object.freeze({
      size: stats.size,
      contentType: CONTENT_TYPES[extension] || 'application/octet-stream',
      open() {
        return createReadStream(filePath);
      },
    }),
  };
}

/** Filesystem media implementation of the Sentence Ladder audio port. */
export class FilesystemLanguageAudioRepository extends ILanguageAudioRepository {
  #mediaDir;
  #userExists;

  constructor({ mediaDir, userExists } = {}) {
    super();
    if (!mediaDir) {
      throw new Error('FilesystemLanguageAudioRepository requires mediaDir');
    }
    if (typeof userExists !== 'function') {
      throw new Error('FilesystemLanguageAudioRepository requires userExists');
    }
    this.#mediaDir = mediaDir;
    this.#userExists = userExists;
  }

  async findPromptAudio({ corpusId, seq, language }) {
    if (!ID_RE.test(String(corpusId))) return { kind: 'not-found' };
    if (!Number.isFinite(Number(seq))) return { kind: 'not-found' };
    if (!LANG_RE.test(String(language))) return { kind: 'not-found' };
    const filePath = buildContainedPath(
      this.#mediaDir,
      `school/language/${corpusId}/${padSeq(seq)}-${String(language).toUpperCase()}.mp3`,
    );
    return foundResource(filePath, 'mp3');
  }

  async findRecordingAudio({ corpusId, userId, seq, language, extensions = [] }) {
    if (!ID_RE.test(String(corpusId))) return { kind: 'not-found' };
    if (!ID_RE.test(String(userId))) return { kind: 'not-found' };
    if (!this.#userExists(userId)) return { kind: 'not-found' };
    if (!Number.isFinite(Number(seq))) return { kind: 'not-found' };
    if (!LANG_RE.test(String(language))) return { kind: 'not-found' };

    for (const extensionValue of extensions) {
      const extension = String(extensionValue).toLowerCase();
      if (!EXT_RE.test(extension)) continue;
      const filePath = buildContainedPath(
        this.#mediaDir,
        `school/language/${corpusId}/recordings/${userId}/${padSeq(seq)}-${String(language).toUpperCase()}.${extension}`,
      );
      const result = foundResource(filePath, extension);
      if (result.kind === 'found') return result;
    }
    return { kind: 'not-found' };
  }

  /** UI cues live beside the course media, under `school/_ux/`. */
  async findCueAudio({ fileName }) {
    if (!CUE_FILE_RE.test(String(fileName))) return { kind: 'not-found' };
    const extension = String(fileName).split('.').pop().toLowerCase();
    const filePath = buildContainedPath(this.#mediaDir, `school/_ux/${fileName}`);
    return foundResource(filePath, extension);
  }
}

export default FilesystemLanguageAudioRepository;
