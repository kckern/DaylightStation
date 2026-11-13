/**
 * YAML persistence for the printed-activity issuance log.
 *
 *   <dataDir>/household/school/records/printed-activities/{learnerId}.yml
 *   { issuances: [ {issuanceId, learnerId, ..., completedAt, completedStudyDay, completedVia} ] }
 *
 * `records/`, not `runtime/`: a completed sheet is evidence a report card is
 * reconstructed from, never pruned by a cooldown or a session close.
 *
 * ONE FILE PER LEARNER, not per study day. The questions asked of this log are
 * "has this child had this page before" (the whole history) and "who holds this
 * page" (every learner), and neither has a day in it. A child prints a sheet or
 * two a day, so a file stays small for years. The cross-learner lookups
 * (`findOpen`, `findAny`, `listOpenAll`) read every learner file; that is a
 * handful of small files in a household.
 *
 * The read/write posture is `YamlReadingLogStore`'s, for the same reasons (its
 * header has the full argument):
 *
 *   - NEVER THROWS ON READ. Missing, empty, corrupt and unreadable all answer
 *     "nothing on record", logged. The worst a bad file can do to a reader is
 *     show a sheet as still owed.
 *   - WRITES ARE READ-MODIFY-WRITE, so `#load` keeps `missing` / `empty` / `ok` /
 *     `corrupt` / `unreadable` apart. On a write, corrupt -> copy the original
 *     bytes to `<learnerId>.yml.corrupt-<stamp>` FIRST, log at error, then start
 *     a fresh file; unreadable -> THROW, because bytes we cannot get are bytes we
 *     cannot preserve.
 *   - AN ENTRY IN `issuances[]` THAT IS NOT SHAPED LIKE AN ISSUANCE is carried
 *     through every rewrite verbatim and warned about, never dropped.
 *   - An unsafe learner id THROWS on write and answers `[]` on read.
 *
 * Writes are serialized on one chain for the whole store (not per learner):
 * the volume is a few sheets a day, and one chain keeps `append`'s duplicate
 * check and `complete`'s already-check honest. All I/O goes through
 * `#system/utils/FileIO.mjs` (see `adapters-no-direct-fs`); files are written
 * with `saveYamlToPathAtomic`.
 */
import path from 'path';
import yaml from 'js-yaml';
import {
  fileExists, readFile, listYamlFiles, writeFileAtomic, saveYamlToPathAtomic,
} from '#system/utils/FileIO.mjs';
import { IPrintedActivityStore } from "../../application/ports/IPrintedActivityStore.mjs";

const LEARNER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const isSafeLearnerId = (id) => typeof id === 'string' && LEARNER_ID_RE.test(id);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true };
const orNull = (value) => (typeof value === 'string' && value ? value : null);
const isIssuance = (entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  && isNonEmptyString(entry.issuanceId);
const isOpen = (issuance) => issuance.completedAt == null;
const REQUIRED = ['learnerId', 'issuanceId', 'platform', 'externalId', 'corpusId'];

/** Filesystem-safe instant: `2026-08-26T18-04-00-000Z`. */
const stampFor = (value) => {
  const at = value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
  return at.toISOString().replace(/[:.]/g, '-');
};

export class YamlPrintedActivityStore extends IPrintedActivityStore {
  #configService;
  #logger;
  #clock;
  #writeChain = Promise.resolve();

  /**
   * @param {object} config
   * @param {object} config.configService - `getHouseholdPath()` provider (required)
   * @param {object} [config.logger]
   * @param {() => Date} [config.clock] - injectable so the side-file name is assertable
   */
  constructor({ configService, logger = console, clock = () => new Date() } = {}) {
    super();
    if (!configService || typeof configService.getHouseholdPath !== 'function') {
      throw new Error('YamlPrintedActivityStore: configService with getHouseholdPath() is required');
    }
    this.#configService = configService;
    this.#logger = logger;
    this.#clock = typeof clock === 'function' ? clock : () => new Date();
  }

  #dir() {
    return this.#configService.getHouseholdPath('school/records/printed-activities');
  }

  #fileFor(learnerId) {
    return path.join(this.#dir(), `${learnerId}.yml`);
  }

  /**
   * Read one learner file. Never throws. `rows` are entries shaped like
   * issuances (what a READER counts); `entries` is the verbatim array (what a
   * WRITER rewrites).
   */
  #load(learnerId) {
    const file = this.#fileFor(learnerId);
    const answer = (status, extra = {}) => ({
      status, rows: [], entries: [], unrecognised: 0, text: null, reason: null, file, ...extra,
    });

    if (!fileExists(file)) return answer('missing');
    const text = readFile(file);
    if (typeof text !== 'string') return answer('unreadable', { reason: 'file exists but could not be read' });
    if (!text.trim()) return answer('empty', { text, reason: 'file is empty' });

    let raw;
    try {
      raw = yaml.load(text);
    } catch (err) {
      return answer('corrupt', { text, reason: err.message });
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.issuances)) {
      return answer('corrupt', { text, reason: 'document is not an issuance log (no issuances[] array)' });
    }
    const entries = raw.issuances;
    const rows = entries.filter(isIssuance);
    const unrecognised = entries.length - rows.length;
    return answer('ok', {
      text, entries, rows, unrecognised,
      reason: unrecognised ? `${unrecognised} unrecognised entr${unrecognised === 1 ? 'y' : 'ies'} in issuances[]` : null,
    });
  }

  #warnUnrecognised(learnerId, loaded) {
    if (!loaded.unrecognised) return;
    this.#logger.warn?.('school.printed-activity.unrecognised-entries', {
      learnerId, file: loaded.file, unrecognised: loaded.unrecognised, error: loaded.reason,
    });
  }

  /** Reader view: rows on `ok`, `[]` (logged) on anything else. */
  #rowsFor(learnerId) {
    if (!isSafeLearnerId(learnerId)) return [];
    const loaded = this.#load(learnerId);
    if (loaded.status === 'missing') return [];
    if (loaded.status === 'corrupt') {
      this.#logger.error?.('school.printed-activity.store-corrupt', {
        learnerId, file: loaded.file, error: loaded.reason,
      });
      return [];
    }
    if (loaded.status !== 'ok') {
      this.#logger.warn?.(`school.printed-activity.${loaded.status === 'empty' ? 'empty' : 'read-failed'}`, {
        learnerId, file: loaded.file, error: loaded.reason,
      });
      return [];
    }
    this.#warnUnrecognised(learnerId, loaded);
    return loaded.rows;
  }

  #learnerIds() {
    return listYamlFiles(this.#dir()).filter(isSafeLearnerId);
  }

  #allRows() {
    return this.#learnerIds().flatMap((learnerId) => this.#rowsFor(learnerId));
  }

  /** Copy the bad bytes aside before anything replaces them. Throws if it cannot. */
  #sideFileCorrupt({ learnerId, file, text, reason }) {
    const base = `${file}.corrupt-${stampFor(this.#clock())}`;
    let preservedAt = base;
    for (let n = 2; fileExists(preservedAt); n += 1) preservedAt = `${base}-${n}`;
    writeFileAtomic(preservedAt, text);
    this.#logger.error?.('school.printed-activity.corrupt-side-filed', {
      learnerId, file, preservedAt, error: reason,
    });
    return preservedAt;
  }

  /**
   * Load for a write: throws on unreadable, side-files corrupt, and answers the
   * entries the rewrite must carry plus the recognised rows.
   */
  #loadForWrite(learnerId) {
    const loaded = this.#load(learnerId);
    if (loaded.status === 'unreadable') {
      this.#logger.error?.('school.printed-activity.unreadable', {
        learnerId, file: loaded.file, error: loaded.reason,
      });
      throw new Error(`YamlPrintedActivityStore: ${loaded.file} exists but cannot be read; refusing to overwrite it`);
    }
    if (loaded.status === 'empty') {
      this.#logger.warn?.('school.printed-activity.empty', { learnerId, file: loaded.file, error: loaded.reason });
    }
    this.#warnUnrecognised(learnerId, loaded);
    if (loaded.status === 'corrupt') {
      this.#sideFileCorrupt({ learnerId, ...loaded });
      return { file: loaded.file, entries: [], rows: [] };
    }
    return { file: loaded.file, entries: loaded.entries, rows: loaded.rows };
  }

  #write(file, entries) {
    saveYamlToPathAtomic(file, { issuances: entries }, DUMP_OPTIONS);
  }

  /** Serialize a read-modify-write. See YamlReadingLogStore on why the chain stays. */
  #serialized(fn) {
    const queued = this.#writeChain.then(fn);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  /** @inheritdoc */
  async append(issuance) {
    for (const key of REQUIRED) {
      if (!isNonEmptyString(issuance?.[key])) {
        throw new Error(`YamlPrintedActivityStore: ${key} is required, got: ${issuance?.[key]}`);
      }
    }
    const { learnerId } = issuance;
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlPrintedActivityStore: unsafe learnerId: ${learnerId}`);
    const stored = {
      issuanceId: issuance.issuanceId,
      learnerId,
      programId: orNull(issuance.programId),
      corpusId: issuance.corpusId,
      platform: issuance.platform,
      externalId: issuance.externalId,
      title: orNull(issuance.title),
      kind: orNull(issuance.kind),
      level: Number.isInteger(issuance.level) ? issuance.level : null,
      issuedAt: orNull(issuance.issuedAt),
      issuedStudyDay: orNull(issuance.issuedStudyDay),
      completedAt: null,
      completedStudyDay: null,
      completedVia: null,
    };
    return this.#serialized(async () => {
      const { file, entries, rows } = this.#loadForWrite(learnerId);
      if (rows.some((row) => row.issuanceId === stored.issuanceId)) {
        throw new Error(`YamlPrintedActivityStore: issuanceId already on record: ${stored.issuanceId}`);
      }
      this.#write(file, [...entries, stored]);
      return stored;
    });
  }

  /** @inheritdoc */
  async listForLearner(learnerId) {
    return this.#rowsFor(learnerId);
  }

  /** @inheritdoc */
  async listOpenAll() {
    return this.#allRows().filter(isOpen);
  }

  /** @inheritdoc */
  async findOpen({ platform, externalId } = {}) {
    if (!isNonEmptyString(platform) || !isNonEmptyString(externalId)) return null;
    return this.#allRows().find((row) => isOpen(row)
      && row.platform === platform && row.externalId === externalId) ?? null;
  }

  /** @inheritdoc */
  async findAny({ platform, externalId } = {}) {
    if (!isNonEmptyString(platform) || !isNonEmptyString(externalId)) return null;
    let latest = null;
    for (const row of this.#allRows()) {
      if (row.platform !== platform || row.externalId !== externalId) continue;
      // ISO instants sort as strings; a row without issuedAt never beats one with it.
      if (latest === null || String(row.issuedAt ?? '') >= String(latest.issuedAt ?? '')) latest = row;
    }
    return latest;
  }

  /** @inheritdoc */
  async complete(learnerId, issuanceId, { at, studyDay, device } = {}) {
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlPrintedActivityStore: unsafe learnerId: ${learnerId}`);
    // Without `at` the issuance would stay open (open == completedAt null), and
    // without `studyDay` the credit lands on no day; both are caller bugs.
    if (!isNonEmptyString(at)) throw new Error('YamlPrintedActivityStore: complete requires `at`');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDay ?? '')) {
      throw new Error(`YamlPrintedActivityStore: studyDay must be YYYY-MM-DD, got: ${studyDay}`);
    }
    return this.#serialized(async () => {
      const { file, entries } = this.#loadForWrite(learnerId);
      const index = entries.findIndex((entry) => isIssuance(entry) && entry.issuanceId === issuanceId);
      if (index < 0) return { status: 'missing', issuance: null };
      const current = entries[index];
      // A second scan: answer what is on disk and write nothing at all.
      if (!isOpen(current)) return { status: 'already', issuance: current };
      const done = {
        ...current,
        completedAt: at,
        completedStudyDay: studyDay,
        completedVia: orNull(device),
      };
      const next = entries.slice();
      next[index] = done;
      this.#write(file, next);
      return { status: 'completed', issuance: done };
    });
  }

  /** @inheritdoc */
  async listCompletedForDay(learnerId, corpusId, studyDay) {
    return this.#rowsFor(learnerId).filter((row) => row.corpusId === corpusId
      && row.completedStudyDay != null && row.completedStudyDay === studyDay);
  }
}

export default YamlPrintedActivityStore;
