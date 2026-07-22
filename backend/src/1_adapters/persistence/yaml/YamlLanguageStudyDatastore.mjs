/**
 * YAML persistence for School's language-study program. Dumb storage only —
 * no ladder logic, no pacing policy (see LanguageStudyService).
 *
 * Everything is scoped by corpus, because a learner may study more than one
 * course and their day counters, queues and recordings must not collide:
 *
 *   corpus:     <dataDir>/content/language/{corpusId}.yml
 *   progress:   <userDir>/apps/school/language/{corpusId}/progress.yml
 *   log:        <userDir>/apps/school/language/{corpusId}/log/{YYYY-MM-DD}.yml   (append-only)
 *   audio:      <mediaDir>/apps/school/language/{corpusId}/{NNNN}-{LANG}.mp3
 *   recordings: <mediaDir>/apps/school/language/{corpusId}/recordings/{userId}/{NNNN}-{LANG}.{ext}
 *
 * Mirrors YamlSchoolDatastore's shape so the two read alike. Progress is the
 * ONLY mutable per-user file; the log is append-only and is the evidence the
 * day queue is derived from.
 */
import path from 'path';
import fs from 'fs';
import { loadYamlSafe, saveYaml, ensureDir, listYamlFiles } from '#system/utils/FileIO.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_RE = /^[A-Za-z]{2,8}$/;

/** Sequence numbers are zero-padded to 4 on disk, matching the source assets. */
export function padSeq(seq) {
  return String(Number(seq)).padStart(4, '0');
}

export class YamlLanguageStudyDatastore {
  #configService;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlLanguageStudyDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
  }

  // -- paths ---------------------------------------------------------------

  #corpusDir() {
    return path.join(this.#configService.getDataDir(), 'content', 'language');
  }

  #userDir(userId, corpusId) {
    // A user id that is not a real profile yields null rather than a path, so
    // a typo can never mint a stray directory tree under data/users/.
    if (!this.#configService.getUserProfile?.(userId)) return null;
    if (!ID_RE.test(String(corpusId))) return null;
    return path.join(
      this.#configService.getUserDir(userId), 'apps', 'school', 'language', String(corpusId),
    );
  }

  #mediaDir(corpusId) {
    if (!ID_RE.test(String(corpusId))) return null;
    return path.join(this.#configService.getMediaDir(), 'apps', 'school', 'language', String(corpusId));
  }

  // -- corpus (shared, read-only) ------------------------------------------

  listCorpusIds() {
    return listYamlFiles(this.#corpusDir()).sort();
  }

  readCorpus(corpusId) {
    if (!ID_RE.test(String(corpusId))) return null;
    return loadYamlSafe(path.join(this.#corpusDir(), String(corpusId)));
  }

  // -- progress (the only mutable per-user file) ---------------------------

  readProgress(userId, corpusId) {
    const dir = this.#userDir(userId, corpusId);
    if (!dir) return null;
    return loadYamlSafe(path.join(dir, 'progress'));
  }

  writeProgress(userId, corpusId, progress) {
    const dir = this.#userDir(userId, corpusId);
    if (!dir) return null;
    ensureDir(dir);
    saveYaml(path.join(dir, 'progress'), progress, { noRefs: true });
    return progress;
  }

  // -- attempt log (append-only evidence) ----------------------------------

  /**
   * The shard is derived from the event's own `at`, never from the clock, so
   * a backfilled or reassigned event lands in the day it actually happened.
   */
  appendEvent(userId, corpusId, event) {
    const dir = this.#userDir(userId, corpusId);
    if (!dir) return null;
    const logDir = path.join(dir, 'log');
    const day = String(event.at).slice(0, 10);
    if (!DAY_RE.test(day)) {
      throw new InfrastructureError('language-study event has no usable timestamp', {
        code: 'INVALID_EVENT_TIMESTAMP', at: event.at,
      });
    }
    ensureDir(logDir);
    const base = path.join(logDir, day);
    const list = loadYamlSafe(base) || [];
    list.push(event);
    saveYaml(base, list, { noRefs: true });
    return event;
  }

  readEventDay(userId, corpusId, day) {
    const dir = this.#userDir(userId, corpusId);
    if (!dir) return [];
    const dayStr = String(day);
    if (!DAY_RE.test(dayStr)) return [];
    return loadYamlSafe(path.join(dir, 'log', dayStr)) || [];
  }

  /**
   * The whole log. The day queue is derived from this on every read — see
   * dayQueue.mjs for why it is derived rather than stored.
   */
  readAllEvents(userId, corpusId) {
    const dir = this.#userDir(userId, corpusId);
    if (!dir) return [];
    const logDir = path.join(dir, 'log');
    if (!fs.existsSync(logDir)) return [];
    return fs.readdirSync(logDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .sort()
      .flatMap((f) => loadYamlSafe(path.join(logDir, f.replace(/\.yml$/, ''))) || []);
  }

  // -- media ---------------------------------------------------------------

  /**
   * Absolute path to a sentence's audio, addressed by (corpus, seq, language)
   * rather than by a caller-supplied filename. Returns null for anything that
   * does not match the expected shape, so a path fragment can never traverse
   * out of the media tree.
   */
  resolveAudioPath(corpusId, seq, language) {
    const dir = this.#mediaDir(corpusId);
    if (!dir) return null;
    if (!Number.isFinite(Number(seq))) return null;
    if (!LANG_RE.test(String(language))) return null;
    return path.join(dir, `${padSeq(seq)}-${String(language).toUpperCase()}.mp3`);
  }

  resolveRecordingPath(corpusId, userId, seq, language, ext = 'webm') {
    const dir = this.#mediaDir(corpusId);
    if (!dir) return null;
    if (!this.#configService.getUserProfile?.(userId)) return null;
    if (!Number.isFinite(Number(seq))) return null;
    if (!LANG_RE.test(String(language))) return null;
    if (!/^[a-z0-9]{2,5}$/i.test(String(ext))) return null;
    return path.join(
      dir, 'recordings', String(userId),
      `${padSeq(seq)}-${String(language).toUpperCase()}.${String(ext).toLowerCase()}`,
    );
  }

  writeRecording(corpusId, userId, seq, language, buffer, ext = 'webm') {
    const target = this.resolveRecordingPath(corpusId, userId, seq, language, ext);
    if (!target) return null;
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, buffer);
    return target;
  }

  /**
   * Which of a user's recordings exist on disk, as a Set of `{seq}-{LANG}`.
   *
   * Presentation only. A recording is "done" because the LOG says so, never
   * because a file is present — evidence is the log. This exists so the
   * Review surface can avoid offering playback for a file that has gone
   * missing under an event that survives.
   */
  listRecordingKeys(corpusId, userId) {
    const dir = this.#mediaDir(corpusId);
    if (!dir || !this.#configService.getUserProfile?.(userId)) return new Set();
    const userRecordings = path.join(dir, 'recordings', String(userId));
    if (!fs.existsSync(userRecordings)) return new Set();
    return new Set(
      fs.readdirSync(userRecordings)
        .map((f) => f.replace(/\.[a-z0-9]+$/i, ''))
        .filter((k) => /^\d{4}-[A-Z]{2,8}$/.test(k))
        .map((k) => `${Number(k.slice(0, 4))}-${k.slice(5)}`),
    );
  }
}

export default YamlLanguageStudyDatastore;
