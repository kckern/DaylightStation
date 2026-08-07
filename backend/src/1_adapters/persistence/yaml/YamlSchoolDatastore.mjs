/**
 * YAML persistence for the school app. Dumb storage only — no grading, no
 * policy (see SchoolService). Mirrors YamlEconomyDatastore's layout:
 *   banks:         <dataDir>/content/school/{subject}/{work}/quizzes/{rest}.yml
 *   attempts:      <userDir>/apps/school/attempts/{YYYY-MM-DD}.yml  (append-only)
 *   quiz requests: <dataDir>/household/apps/school/quiz-requests.yml  (one household list —
 *                  NOT under a quizzes dir, where listBankIds would sweep it up)
 *
 * Banks live inside their WORK, beside that work's units and documents, the way
 * scripture/bom/ already did. The `quizzes/` container is not part of the id:
 * `math/algebra/functions/x` is the file
 * `content/school/math/algebra/quizzes/functions/x.yml`. Dropping that segment
 * from the id is what let every already-nested bank keep its id across the
 * 2026-07-30 moves — only the four loose banks, which had no work segment at
 * all, were renamed.
 */
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {
  loadYaml, loadYamlSafe, saveYamlToPathAtomic, ensureDir, listYamlFiles, resolveYamlPath,
} from '#system/utils/FileIO.mjs';
import { SUBJECT_IDS } from '#domains/school/curriculum/unitValidation.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

// Bank ids are nested paths ("history/i-survived/02-shark-attacks/01-alone") so the
// bank tree can be browsed as folders. Every segment must start alphanumeric, which is
// what keeps traversal out: ".." and hidden names cannot match, nor can a leading "/".
// The first segment is the subject shelf (checked against SUBJECT_IDS) and the second
// is the work, so a THREE-segment minimum is structural rather than stylistic.
//
// Dots are allowed AFTER the first character because 43 imported banks name a
// half-step that way (`multiplying_expressions_0.5`). They were previously
// unreachable through readBankRaw while readAllBankRaws — which did not apply this
// pattern — loaded them fine; routing both through one path made that split visible.
const BANK_ID_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// One flat, alphanumeric-first segment, no dots — matches YamlAssignmentStore's
// learnerId guard. Archive files (`{periodId}.v<n>.yml`, stripped to
// `{periodId}.v<n>`) fail this on the dot, which is exactly what keeps
// `listReportCards` from ever surfacing a superseded copy as current.
const PERIOD_ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const isSafePeriodId = (id) => typeof id === 'string' && PERIOD_ID_RE.test(id);

// saveYamlToPathAtomic (unlike saveYaml) wants a full path — it does not append
// an extension for you — so every base-style path built with path.join(dir, name)
// needs this before it can move to the atomic writer.
const withYamlExt = (base) => (base.endsWith('.yml') || base.endsWith('.yaml') ? base : `${base}.yml`);

export class YamlSchoolDatastore {
  #configService;

  #logger;

  constructor(config = {}) {
    if (!config.configService) {
      throw new InfrastructureError('YamlSchoolDatastore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = config.configService;
    this.#logger = config.logger || console;
  }

  /**
   * Missing and corrupt are DIFFERENT answers (same posture as
   * YamlAcademicPeriodStore#readState): a missing shard is the normal
   * before-first-attempt state; an existing-but-unparseable shard must never
   * be silently treated as empty — that is exactly how a corrupt file gets
   * clobbered down to a single new row, destroying every prior attempt.
   *
   * `file` in the returned shape is the ACTUAL on-disk path when one exists
   * (via `resolveYamlPath`, which tries `.yml` then `.yaml`) — used for
   * diagnostics (log/error `details.file`) so a legacy `.yaml` shard isn't
   * misreported as `.yml`. For `missing`, no such path exists yet, so this
   * falls back to the `.yml` name a write would create.
   */
  #readAttemptShard(base) {
    const resolved = resolveYamlPath(base);
    if (!resolved) return { state: 'missing', rows: [], file: withYamlExt(base) };
    try {
      const rows = loadYaml(base);
      if (!Array.isArray(rows)) return { state: 'corrupt', rows: [], file: resolved };
      return { state: 'ok', rows, file: resolved };
    } catch {
      return { state: 'corrupt', rows: [], file: resolved };
    }
  }

  #schoolDir() { return path.join(this.#configService.getDataDir(), 'content', 'school'); }

  #quizzesDir(subject, work) {
    return path.join(this.#schoolDir(), subject, work, 'quizzes');
  }

  #works(subject) {
    try {
      return fs.readdirSync(path.join(this.#schoolDir(), subject), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Bank id -> file path. An id is `<subject>/<work>/<rest…>`; the `quizzes/`
   * container is NOT part of the id, it is inserted between the work and the
   * rest. So three segments are the minimum, and an unknown subject or a
   * shorter id resolves to null rather than to a stray read.
   */
  #bankFile(bankId) {
    const id = String(bankId);
    if (!BANK_ID_RE.test(id)) return null;
    const [subject, work, ...rest] = id.split('/');
    if (!SUBJECT_IDS.includes(subject) || !work || rest.length === 0) return null;
    return path.join(this.#quizzesDir(subject, work), ...rest);
  }

  #attemptsDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'attempts');
  }

  #quizRequestsPath() {
    return this.#configService.getHouseholdPath('apps/school/quiz-requests');
  }

  readQuizRequests() {
    return loadYamlSafe(this.#quizRequestsPath()) || [];
  }

  saveQuizRequests(list) {
    saveYamlToPathAtomic(withYamlExt(this.#quizRequestsPath()), list, { noRefs: true });
    return list;
  }

  // Printing: an append-only log of completed jobs (feeds the rolling quota)
  // and a pending queue of jobs awaiting a grown-up's approval. Both are one
  // household-wide list under household/apps/school (attribution is the per-entry
  // userId), same shape as quiz-requests.
  #printLogPath() { return this.#configService.getHouseholdPath('apps/school/print-log'); }
  #printPendingPath() { return this.#configService.getHouseholdPath('apps/school/print-pending'); }

  readPrintLog() { return loadYamlSafe(this.#printLogPath()) || []; }

  appendPrintLog(entry) {
    const list = this.readPrintLog();
    list.push(entry);
    saveYamlToPathAtomic(withYamlExt(this.#printLogPath()), list, { noRefs: true });
    return entry;
  }

  /**
   * Retention support (admin advocacy A5): move print-log entries older than
   * `cutoffIso` into an append-only archive file so the hot log — a full
   * read-modify-write on EVERY print and a full read on every quota banner —
   * stays household-week sized. Returns how many moved. The archive is
   * write-only by design: it is the permanent record, not a working set.
   */
  archivePrintLogBefore(cutoffIso) {
    const list = this.readPrintLog();
    const keep = [];
    const old = [];
    for (const entry of list) {
      if (entry?.at && entry.at < cutoffIso) old.push(entry); else keep.push(entry);
    }
    if (!old.length) return 0;
    const archivePath = this.#configService.getHouseholdPath('apps/school/print-log.archive');
    const archived = loadYamlSafe(archivePath) || [];
    saveYamlToPathAtomic(withYamlExt(archivePath), [...archived, ...old], { noRefs: true });
    saveYamlToPathAtomic(withYamlExt(this.#printLogPath()), keep, { noRefs: true });
    return old.length;
  }

  readPrintPending() { return loadYamlSafe(this.#printPendingPath()) || []; }

  savePrintPending(list) {
    saveYamlToPathAtomic(withYamlExt(this.#printPendingPath()), list, { noRefs: true });
    return list;
  }

  listBankIds() {
    return SUBJECT_IDS.flatMap((subject) => this.#works(subject).flatMap((work) => listYamlFiles(this.#quizzesDir(subject, work), { recursive: true })
      .map((rest) => `${subject}/${work}/${rest}`))).sort();
  }

  readBankRaw(bankId) {
    const file = this.#bankFile(bankId);
    return file ? loadYamlSafe(file) : null;
  }

  /**
   * Read every bank's raw YAML ASYNCHRONOUSLY, in bounded-concurrency batches,
   * so the 4600-file scan runs off the main thread (libuv threadpool) instead
   * of blocking the event loop for ~8-10s. Returns [{ id, raw }] (raw null on a
   * parse/read miss). Parsing is sync per file but tiny; batching keeps the
   * per-tick CPU burst small too.
   */
  async readAllBankRaws({ batch = 200 } = {}) {
    const ids = this.listBankIds();
    const out = [];
    for (let i = 0; i < ids.length; i += batch) {
      const slice = ids.slice(i, i + batch);
      // eslint-disable-next-line no-await-in-loop
      const chunk = await Promise.all(slice.map(async (id) => {
        try {
          const file = this.#bankFile(id);
          if (!file) return { id, raw: null };
          const text = await fs.promises.readFile(`${file}.yml`, 'utf8');
          return { id, raw: yaml.load(text) };
        } catch {
          return { id, raw: null };
        }
      }));
      out.push(...chunk);
    }
    return out;
  }

  appendAttempt(userId, attempt) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return null;
    const day = String(attempt.at).slice(0, 10);
    const base = path.join(dir, day);
    const read = this.#readAttemptShard(base);
    if (read.state === 'corrupt') {
      throw new DomainInvariantError('attempt shard is corrupt — refusing to overwrite recorded evidence', {
        code: 'ATTEMPT_SHARD_CORRUPT', details: { userId, file: read.file },
      });
    }
    saveYamlToPathAtomic(withYamlExt(base), [...read.rows, attempt], { noRefs: true });
    return attempt;
  }

  /**
   * Attribution repair (teacher-console spec D1): MOVE a day's attempt
   * events matching one assessment between two learners' shards — the
   * mechanism the append-only design was built to allow ("a later
   * reassignment moves the evidence and the statistics together"). Each
   * moved event is stamped with `{reassignedFrom, reassignedBy,
   * reassignedAt}` and its `attributedTo` rewritten, so provenance survives
   * inside the event itself. Returns the number of events moved.
   */
  moveAttempts({ fromUserId, toUserId, day, assessmentId, reassignedBy = null, at = new Date().toISOString() }) {
    const fromDir = this.#attemptsDir(fromUserId);
    const toDir = this.#attemptsDir(toUserId);
    if (!fromDir || !toDir) return 0;
    const dayStr = String(day);
    if (!DAY_RE.test(dayStr)) return 0;
    const fromBase = path.join(fromDir, dayStr);
    const toBaseCheck = path.join(toDir, dayStr);
    // Same shard = the two writes below would erase the assessment entirely.
    // The use case already refuses from===to; the persistence layer refuses
    // independently — one caller must not be the only thing between an
    // append-only evidence store and silent loss.
    if (path.resolve(fromBase) === path.resolve(toBaseCheck)) return 0;
    const rows = loadYamlSafe(fromBase) || [];
    const matches = (a) => (a?.sessionId ?? a?.provenance?.recordId ?? null) === assessmentId;
    const moving = rows.filter(matches);
    if (!moving.length) return 0;
    const keeping = rows.filter((a) => !matches(a));
    const toBase = path.join(toDir, dayStr);
    // Destination gated the same way appendAttempt is: `loadYamlSafe(toBase)
    // || []` would treat an existing-but-corrupt destination shard as empty
    // and then atomically overwrite it with ONLY the moved rows — the exact
    // clobber class this store exists to close, just reached via reassignment
    // instead of a plain append. Source-side stays tolerant (an unreadable
    // fromBase already returned 0 above, via `rows = loadYamlSafe(...) || []`)
    // because nothing is destroyed there — there is simply nothing to move.
    const destRead = this.#readAttemptShard(toBase);
    if (destRead.state === 'corrupt') {
      throw new DomainInvariantError('attempt shard is corrupt — refusing to overwrite recorded evidence', {
        code: 'ATTEMPT_SHARD_CORRUPT', details: { userId: toUserId, file: destRead.file },
      });
    }
    ensureDir(toDir);
    const target = destRead.rows;
    for (const attempt of moving) {
      target.push({
        ...attempt,
        attributedTo: toUserId,
        reassignedFrom: fromUserId,
        reassignedBy,
        reassignedAt: at,
      });
    }
    // Destination first: a crash BETWEEN the two writes duplicates rather
    // than loses evidence, and a duplicate is visible and fixable. Each
    // individual write is now atomic (saveYamlToPathAtomic), so a crash
    // MID-write can no longer leave a torn/partial shard — this ordering
    // only covers the gap BETWEEN the two atomic writes.

    saveYamlToPathAtomic(withYamlExt(toBase), target, { noRefs: true });
    saveYamlToPathAtomic(withYamlExt(fromBase), keeping, { noRefs: true });
    return moving.length;
  }

  readAttemptDay(userId, day) {
    const dir = this.#attemptsDir(userId);
    if (!dir) return [];
    const dayStr = String(day);
    if (!DAY_RE.test(dayStr)) return [];
    const base = path.join(dir, dayStr);
    const read = this.#readAttemptShard(base);
    if (read.state === 'corrupt') {
      this.#logger.warn?.('school.attempts.shard-corrupt', { file: read.file });
    }
    return read.rows;
  }

  /** Day stamps (YYYY-MM-DD) that have recorded attempts, newest first. */
  listAttemptDays(userId) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .map((f) => f.replace(/\.yml$/, ''))
      .sort()
      .reverse();
  }

  /**
   * One day file's rows for the multi-day readers below — routed through
   * `#readAttemptShard` (not raw `loadYamlSafe`) so a corrupt day is LOUD
   * (logged, same `school.attempts.shard-corrupt` event as `readAttemptDay`)
   * instead of silently vanishing into an empty array. These readers stay
   * tolerant either way — a corrupt day is dropped from the aggregate, the
   * healthy days around it still come back.
   */
  #readAttemptDayFile(dir, filename) {
    const read = this.#readAttemptShard(path.join(dir, filename.replace(/\.yml$/, '')));
    if (read.state === 'corrupt') {
      this.#logger.warn?.('school.attempts.shard-corrupt', { file: read.file });
    }
    return read.rows;
  }

  readAllAttempts(userId) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .sort()
      .flatMap((f) => this.#readAttemptDayFile(dir, f));
  }

  /**
   * Same shape as `readAllAttempts`, but only day files whose name falls
   * within `[fromDay, toDay]` (inclusive) are ever read off disk — a caller
   * asking about last week does not pay to parse three years of history.
   * String comparison is correct ordering for `YYYY-MM-DD` names, so no
   * Date parsing is needed to bound the readdir listing.
   */
  readAttemptsInRange(userId, fromDay, toDay) {
    const dir = this.#attemptsDir(userId);
    if (!dir || !fs.existsSync(dir)) return [];
    const from = String(fromDay);
    const to = String(toDay);
    if (!DAY_RE.test(from) || !DAY_RE.test(to)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.yml$/.test(f))
      .filter((f) => {
        const day = f.slice(0, 10);
        return day >= from && day <= to;
      })
      .sort()
      .flatMap((f) => this.#readAttemptDayFile(dir, f));
  }

  // --- report cards (Task 6, spec R5b) --------------------------------------
  //   <userDir>/apps/school/report-cards/{periodId}.yml            (current freeze)
  //   <userDir>/apps/school/report-cards/{periodId}.v<n>.yml        (superseded, archived)
  //
  // Filed under the LEARNER's own user directory (same home as their attempt
  // log), not the household tree — a report card is that child's record.
  #reportCardsDir(userId) {
    if (!this.#configService.getUserProfile?.(userId)) return null;
    return path.join(this.#configService.getUserDir(userId), 'apps', 'school', 'report-cards');
  }

  readReportCard(userId, periodId) {
    const dir = this.#reportCardsDir(userId);
    if (!dir || !isSafePeriodId(periodId)) return null;
    return loadYamlSafe(path.join(dir, periodId));
  }

  /** Every FROZEN (unversioned) report card on file for a learner. */
  listReportCards(userId) {
    const dir = this.#reportCardsDir(userId);
    if (!dir) return [];
    return listYamlFiles(dir)
      .filter(isSafePeriodId)
      .sort()
      .map((periodId) => loadYamlSafe(path.join(dir, periodId)))
      .filter(Boolean);
  }

  /**
   * Freeze a report card. Refuses when one already exists for this period —
   * frozen report cards are events, never silently-overwritten documents.
   * A supersede close must archive the existing file first (`archiveReportCard`,
   * below); called without that step, this is the ONE place the
   * `REPORT_CARD_ALREADY_CLOSED` invariant is enforced, for the router to map
   * to a 409 regardless of which use case (or a future one) calls it.
   */
  writeReportCard(userId, periodId, payload) {
    const dir = this.#reportCardsDir(userId);
    if (!dir) {
      throw new DomainInvariantError(`writeReportCard: unknown user '${userId}'`, {
        code: 'REPORT_CARD_UNKNOWN_USER', details: { userId },
      });
    }
    if (!isSafePeriodId(periodId)) {
      throw new DomainInvariantError(`writeReportCard: unsafe periodId '${periodId}'`, {
        code: 'REPORT_CARD_INVALID_PERIOD', details: { periodId },
      });
    }
    const file = path.join(dir, `${periodId}.yml`);
    if (fs.existsSync(file)) {
      throw new DomainInvariantError(`Report card for period '${periodId}' is already closed`, {
        code: 'REPORT_CARD_ALREADY_CLOSED', details: { userId, periodId },
      });
    }
    saveYamlToPathAtomic(file, payload, { noRefs: true });
    return payload;
  }

  /**
   * Archive the CURRENT frozen file (if any) to the next free
   * `{periodId}.v<n>.yml`, then remove the unversioned file — clearing the way
   * for `writeReportCard` to freeze anew. The archived copy is never
   * destroyed, only renamed aside. Returns the version number used, or `0`
   * when there was nothing to archive (no prior freeze).
   */
  /**
   * Superseded freeze versions, readable at last (admin advocacy #5): the
   * archived `{periodId}.v<n>.yml` copies were deliberately hidden from
   * `listReportCards` — correctly — but had NO read at all, making the
   * preserved history write-only. Returns [{version, record}], oldest first.
   */
  listReportCardVersions(userId, periodId) {
    const dir = this.#reportCardsDir(userId);
    if (!dir || !isSafePeriodId(periodId)) return [];
    const out = [];
    let n = 1;
    while (fs.existsSync(path.join(dir, `${periodId}.v${n}.yml`))) {
      const record = loadYamlSafe(path.join(dir, `${periodId}.v${n}.yml`));
      if (record) out.push({ version: n, record });
      n += 1;
    }
    return out;
  }

  archiveReportCard(userId, periodId) {
    const dir = this.#reportCardsDir(userId);
    if (!dir || !isSafePeriodId(periodId)) return 0;
    const file = path.join(dir, `${periodId}.yml`);
    if (!fs.existsSync(file)) return 0;
    const current = loadYamlSafe(file);
    let n = 1;
    while (fs.existsSync(path.join(dir, `${periodId}.v${n}.yml`))) n += 1;
    saveYamlToPathAtomic(withYamlExt(path.join(dir, `${periodId}.v${n}`)), current, { noRefs: true });
    fs.unlinkSync(file);
    return n;
  }
}

export default YamlSchoolDatastore;
