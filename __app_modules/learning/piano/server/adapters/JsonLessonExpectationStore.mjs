import path from 'node:path';
import {
  dirExists, ensureDir, fileMtimeMs, listFiles, readTextFromPath, writeFileAtomic,
} from '#system/utils/FileIO.mjs';
import { normalizeExpectation } from '../../portable/practice/lessonExpectation.mjs';

/** Where per-lesson expectation records live under the data dir. */
export function lessonExpectationDirFor(dataDir) {
  return path.join(dataDir, 'content', 'piano', 'lesson-expectations');
}

const bare = (id) => (id == null ? '' : String(id).replace(/^plex:/, ''));
const SEED_FILE = '_measured.json';

/**
 * JsonLessonExpectationStore — one JSON file per show
 * (`<dir>/<showKey>.json`, a ShowDoc) holding that show's lesson expectation
 * records, plus `_measured.json`, the audit's measured seed.
 *
 * Reads keep an index over every show file and rebuild it when any file's
 * mtime changes — checked at most once per `refreshMs` (default 5 s; enrich
 * calls get() per lesson, and each check stats every show file). The store's
 * own writes invalidate at once, so a write is always seen by the next get(); an unreadable or invalid file is skipped (warned once per
 * mtime), so a half-written file can never take credit down with it.
 */
export class JsonLessonExpectationStore {
  #dir;
  #logger;
  #index = new Map();
  #signature = null;
  #warned = new Map();
  #refreshMs;
  #now;
  #lastCheck = -Infinity;

  constructor({ dir, logger = console, refreshMs = 5000, now = () => Date.now() }) {
    this.#dir = dir;
    this.#logger = logger;
    this.#refreshMs = refreshMs;
    this.#now = now;
  }

  #showFiles() {
    if (!this.#dir || !dirExists(this.#dir)) return [];
    return listFiles(this.#dir).filter((f) => f.endsWith('.json') && f !== SEED_FILE && !f.startsWith('.'));
  }

  #readDoc(file) {
    const full = path.join(this.#dir, file);
    const mtime = fileMtimeMs(full);
    try {
      const doc = JSON.parse(readTextFromPath(full));
      if (!doc || typeof doc !== 'object' || !doc.lessons || typeof doc.lessons !== 'object') throw new Error('no lessons');
      return doc;
    } catch (err) {
      if (this.#warned.get(file) !== mtime) {
        this.#warned.set(file, mtime);
        this.#logger.warn?.('piano.lesson-expectation.unreadable', { file, error: err.message });
      }
      return null;
    }
  }

  #refresh() {
    const t = this.#now();
    if (this.#signature !== null && t - this.#lastCheck < this.#refreshMs) return;
    this.#lastCheck = t;
    const files = this.#showFiles();
    const sig = files.map((f) => `${f}:${fileMtimeMs(path.join(this.#dir, f))}`).join('|');
    if (sig === this.#signature) return;
    const index = new Map();
    for (const file of files) {
      const doc = this.#readDoc(file);
      if (!doc) continue;
      const showKey = bare(doc.show?.key ?? file.replace(/\.json$/, ''));
      for (const [id, raw] of Object.entries(doc.lessons)) {
        const e = normalizeExpectation({ ...raw, plexId: raw?.plexId ?? id });
        if (e) index.set(e.plexId, { ...e, showKey: raw?.showKey ?? showKey, seasonKey: raw?.seasonKey ?? null });
      }
    }
    this.#index = index;
    this.#signature = sig;
  }

  /** The expectation record for a lesson (`plex:123` or `123`), or null. */
  get(plexId) {
    try {
      this.#refresh();
      return this.#index.get(bare(plexId)) ?? null;
    } catch (err) {
      this.#logger.warn?.('piano.lesson-expectation.read-failed', { error: err.message });
      return null;
    }
  }

  /** Every record (for calibration reports). */
  all() {
    this.#refresh();
    return [...this.#index.values()];
  }

  readShow(showKey) {
    const file = `${bare(showKey)}.json`;
    if (!this.#dir || !dirExists(this.#dir)) return null;
    return listFiles(this.#dir).includes(file) ? this.#readDoc(file) : null;
  }

  /** Write one lesson into its show's file (tmp + rename). */
  writeLesson(show, expectation) {
    return this.writeLessons(show, [expectation])[0] ?? null;
  }

  /**
   * Write many lessons of one show with ONE read and ONE write (tmp + rename).
   * A big show rewritten per lesson blocked the event loop for seconds.
   */
  writeLessons(show, expectations) {
    const showKey = bare(show?.key);
    if (!showKey) throw new Error('writeLessons requires show.key');
    const list = (expectations || []).map((raw) => ({ raw, e: normalizeExpectation(raw) }));
    if (list.some(({ e }) => !e)) throw new Error('writeLessons: invalid expectation');
    if (!list.length) return [];
    ensureDir(this.#dir);
    const doc = this.readShow(showKey) || { schemaVersion: 1, show: { key: showKey, title: show.title ?? null }, lessons: {} };
    doc.schemaVersion = 1;
    doc.show = { key: showKey, title: show.title ?? doc.show?.title ?? null };
    doc.generatedAt = new Date().toISOString();
    const written = list.map(({ raw, e }) => {
      doc.lessons[e.plexId] = { ...e, showKey, seasonKey: raw.seasonKey != null ? bare(raw.seasonKey) : null };
      return doc.lessons[e.plexId];
    });
    writeFileAtomic(path.join(this.#dir, `${showKey}.json`), `${JSON.stringify(doc)}\n`);
    this.#signature = null;
    this.#lastCheck = -Infinity;
    return written;
  }

  /** The audit's measured lessons: [{ show, season, episode, n, minNpm, medianNpm, maxNpm }]. */
  readMeasuredSeed() {
    const full = this.#dir ? path.join(this.#dir, SEED_FILE) : null;
    if (!full || !dirExists(this.#dir) || !listFiles(this.#dir).includes(SEED_FILE)) return [];
    try {
      const rows = JSON.parse(readTextFromPath(full));
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      this.#logger.warn?.('piano.lesson-expectation.unreadable', { file: SEED_FILE, error: err.message });
      return [];
    }
  }
}

export default JsonLessonExpectationStore;
