/**
 * YAML persistence for the printed-activity issuance log.
 *
 *   <dataDir>/household/school/records/printed-activities/{learnerId}.yml
 *   { issuances: [ {issuanceId, learnerId, ..., completedAt, completedStudyDay, completedVia, voidedAt, voidReason} ] }
 *
 * `records/`, not `runtime/`: a completed sheet is evidence a report card is
 * reconstructed from, never pruned by a cooldown or a session close.
 *
 * ONE FILE PER LEARNER, not per study day. The questions asked of this log are
 * "has this child had this page before" (the whole history) and "who holds this
 * page" (every learner), and neither has a day in it. A child prints a sheet or
 * two a day, so a file stays small for years. The cross-learner lookups
 * (`findOpen`, `findAny`, `listOpenAll`, `listIssuedExternalIds`) read every learner file; that is a
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
 * the volume is a few sheets a day, and one chain is what makes `append`'s
 * cross-learner "one open issuance per page" check atomic (it throws
 * `PageAlreadyOpenError`), along with its duplicate-id check and `complete`'s
 * already-check, plus its "one open issuance per learner and corpus" check
 * (`CorpusAlreadyOpenError`) and `void`'s status check. Cross-learner reads are partial when a learner file cannot be
 * read, and log `school.printed-activity.lookup-partial` naming who is missing. All I/O goes through
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
/** Open = printed (reserved) and neither scanned nor voided. */
const isOpen = (issuance) => issuance.completedAt == null && issuance.voidedAt == null;
const REQUIRED = ['learnerId', 'issuanceId', 'platform', 'externalId', 'corpusId'];
const instant = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isNaN(ms) ? -Infinity : ms;
};

/**
 * The page is already printed and unscanned for some child. A page id must
 * resolve to exactly one child, so the store refuses the second issuance
 * rather than trusting every caller's pre-check.
 */
export class PageAlreadyOpenError extends Error {
  constructor({ platform, externalId, heldBy, issuanceId }) {
    super(`YamlPrintedActivityStore: ${platform}:${externalId} is already open for ${heldBy} (${issuanceId})`);
    this.name = 'PageAlreadyOpenError';
    this.code = 'PAGE_ALREADY_OPEN';
    this.platform = platform;
    this.externalId = externalId;
    this.heldBy = heldBy;
    this.issuanceId = issuanceId;
  }
}

/**
 * This learner already holds an open sheet in this corpus. One open sheet per
 * corpus is what makes a double scan of the ticket a reprint instead of a
 * second page; `held` is the issuance they hold.
 */
export class CorpusAlreadyOpenError extends Error {
  constructor({ learnerId, corpusId, held }) {
    super(`YamlPrintedActivityStore: ${learnerId} already holds an open ${corpusId} sheet (${held?.issuanceId})`);
    this.name = 'CorpusAlreadyOpenError';
    this.code = 'CORPUS_ALREADY_OPEN';
    this.learnerId = learnerId;
    this.corpusId = corpusId;
    this.held = held;
  }
}

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

  /**
   * Reader view: rows on `ok`, `[]` (logged) on anything else. `lost` is true
   * when the file holds evidence we could not read (corrupt or unreadable), as
   * opposed to holding none (missing or empty).
   */
  #readRows(learnerId) {
    if (!isSafeLearnerId(learnerId)) return { rows: [], lost: false };
    const loaded = this.#load(learnerId);
    if (loaded.status === 'missing') return { rows: [], lost: false };
    if (loaded.status === 'corrupt') {
      this.#logger.error?.('school.printed-activity.store-corrupt', {
        learnerId, file: loaded.file, error: loaded.reason,
      });
      return { rows: [], lost: true };
    }
    if (loaded.status !== 'ok') {
      this.#logger.warn?.(`school.printed-activity.${loaded.status === 'empty' ? 'empty' : 'read-failed'}`, {
        learnerId, file: loaded.file, error: loaded.reason,
      });
      return { rows: [], lost: loaded.status === 'unreadable' };
    }
    this.#warnUnrecognised(learnerId, loaded);
    return { rows: loaded.rows, lost: false };
  }

  /** Learner ids with a `<id>.yml` file. Never throws: an unlistable directory answers []. */
  #learnerIds() {
    let names;
    try {
      names = listYamlFiles(this.#dir(), { stripExtension: false });
    } catch (err) {
      this.#logger.error?.('school.printed-activity.list-failed', { dir: this.#dir(), error: err.message });
      return [];
    }
    return names
      .filter((name) => name.endsWith('.yml'))
      .map((name) => name.slice(0, -'.yml'.length))
      .filter(isSafeLearnerId);
  }

  /**
   * Every learner's rows. A learner whose file cannot be read contributes
   * nothing, so the answer is PARTIAL: that child's open pages are invisible,
   * and a page they hold could look free. Say so, by name, at warn.
   */
  #allRows() {
    const rows = [];
    const lost = [];
    for (const learnerId of this.#learnerIds()) {
      const read = this.#readRows(learnerId);
      rows.push(...read.rows);
      if (read.lost) lost.push(learnerId);
    }
    if (lost.length) {
      this.#logger.warn?.('school.printed-activity.lookup-partial', { learnerIds: lost, dir: this.#dir() });
    }
    return rows;
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
   * Load for a write: throws on unreadable, and answers the entries the rewrite
   * must carry plus the recognised rows. A corrupt file answers no entries and
   * is side-filed by `#write`, i.e. only when something is about to replace it —
   * a scan that writes nothing must not add a rescue copy every time.
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
      return { file: loaded.file, entries: [], rows: [], corrupt: { learnerId, ...loaded } };
    }
    return { file: loaded.file, entries: loaded.entries, rows: loaded.rows, corrupt: null };
  }

  #write({ file, corrupt }, entries) {
    if (corrupt) this.#sideFileCorrupt(corrupt);
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
      voidedAt: null,
      voidReason: null,
    };
    return this.#serialized(async () => {
      const target = this.#loadForWrite(learnerId);
      if (target.rows.some((row) => row.issuanceId === stored.issuanceId)) {
        throw Object.assign(
          new Error(`YamlPrintedActivityStore: issuanceId already on record: ${stored.issuanceId}`),
          { code: 'DUPLICATE_ISSUANCE_ID' },
        );
      }
      // One open sheet per learner and corpus, checked here so two scans of
      // the same ticket cannot both reserve a page.
      const held = target.rows.find((row) => isOpen(row) && row.corpusId === stored.corpusId);
      if (held) throw new CorpusAlreadyOpenError({ learnerId, corpusId: stored.corpusId, held });
      // Inside the chain, so two children cannot both be handed the same page
      // between one caller's check and its write.
      const holder = this.#allRows().find((row) => isOpen(row)
        && row.platform === stored.platform && row.externalId === stored.externalId);
      if (holder) {
        throw new PageAlreadyOpenError({
          platform: stored.platform, externalId: stored.externalId,
          heldBy: holder.learnerId, issuanceId: holder.issuanceId,
        });
      }
      this.#write(target, [...target.entries, stored]);
      return stored;
    });
  }

  /** @inheritdoc */
  async listForLearner(learnerId) {
    return this.#readRows(learnerId).rows;
  }

  /** @inheritdoc */
  async listOpenAll() {
    return this.#allRows().filter(isOpen);
  }

  /** @inheritdoc */
  async listIssuedExternalIds(platform) {
    if (!isNonEmptyString(platform)) return [];
    const ids = new Set();
    for (const row of this.#allRows()) {
      if (row.platform === platform && row.voidedAt == null && isNonEmptyString(row.externalId)) ids.add(row.externalId);
    }
    return [...ids];
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
    // Compared as instants, not strings (offsets differ). An unparseable or
    // missing `issuedAt` counts as -Infinity; on a tie the later row wins —
    // later in its file, and later in learner-file listing order.
    let latest = null;
    for (const row of this.#allRows()) {
      if (row.platform !== platform || row.externalId !== externalId) continue;
      if (latest === null || instant(row.issuedAt) >= instant(latest.issuedAt)) latest = row;
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
      const target = this.#loadForWrite(learnerId);
      const { entries } = target;
      const index = entries.findIndex((entry) => isIssuance(entry) && entry.issuanceId === issuanceId);
      if (index < 0) return { status: 'missing', issuance: null };
      const current = entries[index];
      // A voided reservation never reached paper; it can never be credited.
      if (current.voidedAt != null) return { status: 'voided', issuance: current };
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
      this.#write(target, next);
      return { status: 'completed', issuance: done };
    });
  }

  /** @inheritdoc */
  async void(learnerId, issuanceId, { at, reason } = {}) {
    if (!isSafeLearnerId(learnerId)) throw new Error(`YamlPrintedActivityStore: unsafe learnerId: ${learnerId}`);
    if (!isNonEmptyString(at)) throw new Error('YamlPrintedActivityStore: void requires `at`');
    return this.#serialized(async () => {
      const target = this.#loadForWrite(learnerId);
      const { entries } = target;
      const index = entries.findIndex((entry) => isIssuance(entry) && entry.issuanceId === issuanceId);
      if (index < 0) return { status: 'missing', issuance: null };
      const current = entries[index];
      if (current.voidedAt != null) return { status: 'already', issuance: current };
      // A scanned sheet is evidence of work done; nothing un-does it.
      if (current.completedAt != null) return { status: 'completed', issuance: current };
      const voided = { ...current, voidedAt: at, voidReason: orNull(reason) };
      const next = entries.slice();
      next[index] = voided;
      this.#write(target, next);
      return { status: 'voided', issuance: voided };
    });
  }

  /** @inheritdoc */
  async listCompletedForDay(learnerId, corpusId, studyDay) {
    return this.#readRows(learnerId).rows.filter((row) => row.corpusId === corpusId
      && row.voidedAt == null
      && row.completedStudyDay != null && row.completedStudyDay === studyDay);
  }
}

export default YamlPrintedActivityStore;
