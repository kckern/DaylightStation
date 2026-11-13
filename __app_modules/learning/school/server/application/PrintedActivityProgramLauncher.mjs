/**
 * PrintedActivityProgramLauncher — the `IProgramLauncher` for a daily
 * obligation met on paper: `launch()` prints one page from a worksheet
 * platform (Beeloo: mazes, easy sudoku) and records it as an open issuance; a
 * grown-up's scan of the page's QR completes it (a separate use case). See
 * ops:docs/superpowers/specs/2026-11-13-printed-activity-program-design.md.
 *
 * ONE ENTRY PER CORPUS. A learner may hold a maze entry and a sudoku entry at
 * once; `programInstance` / `corpusId` picks which. Each is counted alone.
 *
 * RESERVE, PRINT, VOID. `launch()` appends the issuance (a reservation)
 * before printing, and voids it if the printer throws or reports a dry run,
 * so a page is never printed for a child the log does not name, and a race
 * with a sibling is settled before any paper moves. A double scan of the
 * ticket reprints the page already held, once a reprint cooldown has passed.
 * Details on `launch()`.
 *
 * A PAGE IS NEVER ISSUED TWICE IN THE HOUSEHOLD. Once a page has reached
 * paper for any child (open or completed), no child is given it again on that
 * platform: the QR on every copy is the same, so a re-issue would let an old
 * copy credit its new holder. Voided reservations stay eligible.
 *
 * Like story time there is no course: `doneToday` is completed sheets on the
 * study day against the entry's `target`, and the program is never terminal.
 * An unreadable enrollment or log is `error: true`, never a false zero; not
 * enrolled is `error: false, enrolled: false`.
 *
 * Application layer: the clock and the rng are injected (no ambient time or
 * randomness), and the store's typed refusals (`PAGE_ALREADY_OPEN`,
 * `CORPUS_ALREADY_OPEN`, `DUPLICATE_ISSUANCE_ID`) are recognised by `code`, so
 * this file never imports the adapter that defines them.
 */
import { studyDayForInstant } from '../domain/studyDay.mjs';
import {
  PRINTED_ACTIVITY_PROGRAM_ID, servedUnitId, validatePrintedActivityEnrollment, pickActivity, printedActivityLabel,
} from '../domain/printedActivity.mjs';

// The store's typed refusals, recognised by `code` so this file never imports the adapter.
const PAGE_ALREADY_OPEN = 'PAGE_ALREADY_OPEN';
const CORPUS_ALREADY_OPEN = 'CORPUS_ALREADY_OPEN';
const DUPLICATE_ISSUANCE_ID = 'DUPLICATE_ISSUANCE_ID';
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/**
 * How long a sheet that just came out blocks a reprint of it. Mirrors
 * `school.yml printing.printCooldownMinutes` (default 10), which composition
 * passes through: the launcher prints with `printer.printPdf` directly, so the
 * household page quota in PrintService never sees a repeated ticket scan.
 */
const DEFAULT_REPRINT_COOLDOWN_MS = 10 * 60_000;

const MSG = Object.freeze({
  notAssigned: 'This activity is not assigned.',
  platform: 'Worksheets are unavailable right now. Ask a grown-up.',
  noPrinter: 'The printer is not set up. Ask a grown-up.',
  printFailed: 'The printer did not answer. Try the ticket again.',
  race: 'That page was just given to someone else. Scan the ticket again.',
  justPrinted: 'That sheet just printed. Check the printer tray.',
  record: 'That page could not be saved. Ask a grown-up.',
  unexpected: 'Something went wrong printing that page. Ask a grown-up.',
});

const errText = (err) => err?.message ?? String(err);

/** Raised inside `launch()` to answer a platform fault with one wording. */
class PlatformFault extends Error {
  constructor(cause) { super(errText(cause)); this.cause = cause; }
}

export class PrintedActivityProgramLauncher {
  #assignments; #store; #platforms; #printer; #timezone; #clock; #rng; #logger; #reprintCooldownMs;

  /**
   * @param {object} deps
   * @param {{get: (learnerId: string) => Promise<object|null>}} deps.assignments
   * @param {import('./ports/IPrintedActivityStore.mjs').IPrintedActivityStore} deps.store
   * @param {Map<string, object>} [deps.platforms] platform id → IWorksheetPlatform
   * @param {{printPdf: Function}|null} [deps.printer] null → `launch()` answers failed
   * @param {string|null} [deps.timezone]
   * @param {() => Date} deps.clock
   * @param {() => number} deps.rng returns [0, 1)
   * @param {object} deps.logger
   * @param {number} [deps.reprintCooldownMs] a reprint of the sheet this learner
   *   holds is refused this long after it last came out (default 10 minutes)
   */
  constructor({
    assignments, store, platforms = new Map(), printer = null, timezone = null, clock, rng, logger,
    reprintCooldownMs = DEFAULT_REPRINT_COOLDOWN_MS,
  } = {}) {
    if (!assignments) throw new Error('PrintedActivityProgramLauncher requires an assignments store');
    if (!store) throw new Error('PrintedActivityProgramLauncher requires a printed-activity store');
    if (typeof clock !== 'function') throw new Error('PrintedActivityProgramLauncher requires a clock');
    if (typeof rng !== 'function') throw new Error('PrintedActivityProgramLauncher requires an rng');
    if (!logger) throw new Error('PrintedActivityProgramLauncher requires a logger');
    if (typeof reprintCooldownMs !== 'number' || !Number.isFinite(reprintCooldownMs) || reprintCooldownMs < 0) {
      throw new Error('PrintedActivityProgramLauncher: reprintCooldownMs must be a number >= 0');
    }
    this.#reprintCooldownMs = reprintCooldownMs;
    this.#assignments = assignments;
    this.#store = store;
    this.#platforms = platforms ?? new Map();
    this.#printer = printer;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#rng = rng;
    this.#logger = logger;
  }

  get id() { return PRINTED_ACTIVITY_PROGRAM_ID; }

  /** Where the work comes out, in the words a child reads. */
  get locationHint() { return 'on the printer'; }

  /** No DoNow surface: the page arrives on paper, so routing goes through `launch()`. */
  get surface() { return null; }

  /** Not started by a card tap at a reader — the ticket scan calls `launch()`. */
  get entryAction() { return null; }

  /** The issuance log keeps `completedStudyDay`, so any day can be re-read. */
  get replayable() { return true; }

  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  /**
   * The learner's entry for this corpus, in three answers:
   * `{unreadable: true}` (no assignment record), `{enrolled: false}` (record
   * read fine, no entry for this corpus), or `{enrolled: true, entry}` with
   * the validated enrollment. An entry that fails validation is
   * `{invalid: errors}` — enrolled, but not usable.
   */
  async #enrollmentFor(userId, corpusId) {
    const assignment = await this.#assignments.get(userId);
    if (!assignment || typeof assignment !== 'object') return { unreadable: true };
    const programs = Array.isArray(assignment.programs) ? assignment.programs : [];
    const raw = programs.find((p) => p?.programId === PRINTED_ACTIVITY_PROGRAM_ID && p?.corpusId === corpusId);
    if (!raw) return { enrolled: false };
    const { errors, enrollment } = validatePrintedActivityEnrollment(raw);
    if (errors.length) return { enrolled: true, invalid: errors };
    return { enrolled: true, entry: enrollment };
  }

  #unavailable(enrolled = null, progressLabel = 'Printed activity unavailable') {
    return {
      error: true, enrolled, doneToday: false, progressLabel,
      score: null, terminal: false, obligationProgress: null, servedWork: [],
    };
  }

  #notEnrolled() {
    return {
      error: false, enrolled: false, doneToday: false, progressLabel: 'No printed activity',
      score: null, terminal: false, obligationProgress: null, servedWork: [],
    };
  }

  /** "Maze" — the household's title for the entry, else its kind. */
  #label(entry) {
    return printedActivityLabel(entry);
  }

  async status({ userId, programInstance = null, day = null }) {
    const studyDay = day ?? this.studyDay();
    let enrollment;
    try {
      enrollment = await this.#enrollmentFor(userId, programInstance);
    } catch (err) {
      this.#log('error', 'school.printed-activity.enrollment-unreadable', { userId, corpusId: programInstance, error: errText(err) });
      return this.#unavailable();
    }
    if (enrollment.unreadable) {
      this.#log('error', 'school.printed-activity.enrollment-unreadable', { userId, corpusId: programInstance, reason: 'no readable assignment' });
      return this.#unavailable();
    }
    if (!enrollment.enrolled) return this.#notEnrolled();
    if (enrollment.invalid) {
      this.#log('error', 'school.printed-activity.entry-invalid', { userId, corpusId: programInstance, errors: enrollment.invalid });
      return this.#unavailable(true);
    }
    const { entry } = enrollment;
    // A ticket for a platform that is not wired can only fail when scanned, so
    // the agenda shows its standard unavailable state instead. Debug, not
    // warn: the board asks for status often, and `launch()` and the boot's
    // `school.worksheets.unwired` already say it at warn.
    if (!this.#platforms.get(entry.activity.platform)) {
      this.#log('debug', 'school.printed-activity.platform-missing', { userId, corpusId: entry.corpusId, platform: entry.activity.platform });
      return this.#unavailable(true, 'Worksheets unavailable');
    }
    let rows;
    try {
      // Throws (`code: 'LOG_UNREADABLE'`) on a corrupt or unreadable log, so a
      // lost record is answered unavailable rather than as a false "0 of 1".
      rows = await this.#store.listCompletedForDay(userId, entry.corpusId, studyDay);
    } catch (err) {
      this.#log('error', 'school.printed-activity.log-unreadable', {
        userId, corpusId: entry.corpusId, day: studyDay, code: err?.code ?? null, error: errText(err),
      });
      return this.#unavailable(true);
    }
    const done = Array.isArray(rows) ? rows : [];
    const n = done.length;
    const { target } = entry;
    const doneToday = n >= target;
    // ISO timestamps sort as strings; the most recent sheet names the disc.
    const last = done.reduce((a, b) => (String(b?.completedAt ?? '') >= String(a?.completedAt ?? '') ? b : a), done[0]);
    return {
      error: false,
      enrolled: true,
      doneToday,
      progressLabel: `${n} of ${target} ${target === 1 ? 'sheet' : 'sheets'}`,
      score: null,
      terminal: false,
      subject: entry.subject,
      obligationProgress: { completed: Math.min(n, target), total: target },
      // No work session behind this program, so the served page is what keeps
      // its finished disc on the board. Never an `assignmentUnitId` here.
      servedWork: doneToday
        ? [{ unitId: servedUnitId(entry.corpusId), title: last?.title ? `${this.#label(entry)}: ${last.title}` : this.#label(entry) }]
        : [],
    };
  }

  #issuanceId() {
    let id = '';
    for (let i = 0; i < 8; i += 1) {
      const at = Math.floor(this.#rng() * ID_ALPHABET.length);
      id += ID_ALPHABET[Math.min(ID_ALPHABET.length - 1, Math.max(0, Number.isFinite(at) ? at : 0))];
    }
    return `pa_${id}`;
  }

  /** Logging must never turn a `{decision}` answer into a throw. */
  #log(level, event, data) {
    try { this.#logger[level]?.(event, data); } catch { /* a broken logger is not the child's problem */ }
  }

  /** Fetch a page's PDF, answering platform faults as `PlatformFault`. */
  async #printable(platform, externalId, paper) {
    try {
      return await platform.getPrintable(externalId, { paper });
    } catch (err) { throw new PlatformFault(err); }
  }

  /**
   * Release a reservation that never reached paper. A failure is logged and
   * swallowed: the caller's answer to the child does not change.
   */
  async #void(userId, issuance, at, reason) {
    try {
      const r = await this.#store.void(userId, issuance.issuanceId, { at, reason });
      this.#log('info', 'school.printed-activity.voided', {
        learnerId: userId, corpusId: issuance.corpusId, issuanceId: issuance.issuanceId, reason, status: r?.status ?? null,
      });
    } catch (err) {
      this.#log('error', 'school.printed-activity.void-failed', {
        learnerId: userId, corpusId: issuance.corpusId, issuanceId: issuance.issuanceId, reason, error: errText(err),
      });
    }
  }

  /**
   * Record that paper came out, for the reprint cooldown. A failure is logged
   * and swallowed: the sheet is printing either way, and the worst case is one
   * extra reprint allowed (the cooldown falls back to `issuedAt`).
   */
  async #markPrinted(userId, issuance, at) {
    try {
      await this.#store.markPrinted(userId, issuance.issuanceId, { at });
    } catch (err) {
      this.#log('warn', 'school.printed-activity.mark-printed-failed', {
        learnerId: userId, corpusId: issuance.corpusId, issuanceId: issuance.issuanceId, error: errText(err),
      });
    }
  }

  /**
   * Reserve a new page: pick, fetch, `append`. Never prints. Answers
   * `{reserved, bytes, issuance}` for a new reservation, `{reprint}` when the
   * store says this learner already holds a page (a double scan), or
   * `{failed}` with the child's message.
   *
   * A race with a sibling for the picked page is retried ONCE, excluding that
   * page; a second race is answered as a race. A duplicate issuanceId is
   * retried once with a fresh id. Nothing has been printed at any of these
   * points, so a lost race never puts paper in the wrong child's hand.
   */
  async #reserve({ userId, entry, platform, now, studyDay }) {
    const { platform: platformId, kind, level, paper } = entry.activity;
    let pool;
    try {
      pool = await platform.listActivities({ kind, level, paper });
    } catch (err) { throw new PlatformFault(err); }
    // Never-repeat is household-wide per platform: every page that reached
    // paper for ANY child (open or completed) is excluded. Every copy of a page
    // carries the same QR, so re-issuing a sibling's completed page would let
    // that old copy's scan credit this child. A voided reservation never
    // reached paper, so the store leaves it out and it stays eligible.
    const exclude = new Set(await this.#store.listIssuedExternalIds(platformId) ?? []);

    let raceRetried = false;
    let idRetried = false;
    let resampled = false;
    let page = null;
    let bytes = null;
    for (;;) {
      if (!page) {
        page = pickActivity({ pool, exclude, rng: this.#rng });
        if (!page && !resampled) {
          // The platform's list can be a SAMPLE of the level (Beeloo's is a
          // random 250), so an exhausted list need not be an exhausted level.
          // Ask once more for a fresh sample before telling a grown-up.
          resampled = true;
          try {
            pool = await platform.listActivities({ kind, level, paper });
          } catch (err) {
            // The first list loaded fine, so the honest answer is still "no
            // new pages", not "worksheets are unavailable".
            this.#log('warn', 'school.printed-activity.resample-failed', {
              userId, corpusId: entry.corpusId, platform: platformId, error: errText(err),
            });
            pool = [];
          }
          continue;
        }
        if (!page) {
          this.#log('warn', 'school.printed-activity.pool-exhausted', {
            userId, corpusId: entry.corpusId, platform: platformId, kind, level,
            poolSize: Array.isArray(pool) ? pool.length : 0, resampled,
          });
          return { failed: `No new ${kind} pages left at this level. Ask a grown-up.` };
        }
        bytes = await this.#printable(platform, page.externalId, paper);
      }
      const issuance = {
        issuanceId: this.#issuanceId(),
        learnerId: userId,
        programId: PRINTED_ACTIVITY_PROGRAM_ID,
        corpusId: entry.corpusId,
        platform: platformId,
        externalId: page.externalId,
        title: page.title ?? null,
        kind,
        level,
        issuedAt: now.toISOString(),
        issuedStudyDay: studyDay,
        completedAt: null,
        completedStudyDay: null,
        completedVia: null,
      };
      try {
        await this.#store.append(issuance);
        return { reserved: issuance, bytes };
      } catch (err) {
        if (err?.code === CORPUS_ALREADY_OPEN && err.held) {
          // A second scan of the ticket landed between our read and our write.
          return { reprint: err.held };
        }
        // A page held open by THIS learner is not ours to reprint: the store
        // checks the corpus first, so a same-learner hold here is under another
        // corpus, and borrowing that sheet would let this ticket credit it.
        // Treat it like any other holder and pick again.
        if (err?.code === PAGE_ALREADY_OPEN) {
          this.#log('warn', 'school.printed-activity.page-race', {
            userId, corpusId: entry.corpusId, platform: platformId, externalId: page.externalId,
            heldBy: err.heldBy ?? null, retried: raceRetried,
          });
          if (raceRetried) return { failed: MSG.race };
          raceRetried = true;
          exclude.add(page.externalId);
          page = null;
          continue;
        }
        if (err?.code === DUPLICATE_ISSUANCE_ID && !idRetried) {
          idRetried = true;
          continue;
        }
        this.#log('error', 'school.printed-activity.record-failed', {
          userId, corpusId: entry.corpusId, platform: platformId, externalId: page.externalId, error: errText(err),
        });
        return { failed: MSG.record };
      }
    }
  }

  /**
   * Print one page for this learner. `{decision, message}` — DoNow's contract;
   * `ResolveScanAction` relays a failed `message` verbatim. Never throws.
   *
   * RESERVE, THEN PRINT, THEN VOID ON FAILURE. A new page is `append`ed (the
   * reservation) before a byte reaches the printer; a printer throw voids it
   * (`print-failed`) and a dry-run printer's `confirmed === false` voids it
   * (`print-unconfirmed`) — IssueDocument's rollback of an unconfirmed
   * allocation, for the same reason: a durable claim must not point at paper
   * that does not exist.
   *
   * REPRINT. A learner who already holds an open page in this corpus gets THAT
   * page again (the lost-sheet path); nothing is appended or voided. A double
   * scan resolves the same way even when both scans race past the read: the
   * store refuses the second reservation (`CORPUS_ALREADY_OPEN`, checked before
   * the page) and the loser reprints the winner's page.
   *
   * REPRINT COOLDOWN. A reprint is refused ("That sheet just printed") while
   * the held sheet's `lastPrintedAt` (else `issuedAt`) is younger than
   * `reprintCooldownMs`; every confirmed print records `lastPrintedAt` via
   * `store.markPrinted`. So the loser of a double scan, whose page came out a
   * moment ago, is told so rather than printing it twice.
   */
  async launch({ userId, corpusId }) {
    const failed = (message) => ({ decision: 'failed', message });
    try {
      let enrollment;
      try {
        enrollment = await this.#enrollmentFor(userId, corpusId);
      } catch (err) {
        enrollment = { unreadable: true, error: errText(err) };
      }
      if (enrollment.unreadable) {
        this.#log('error', 'school.printed-activity.enrollment-unreadable', { userId, corpusId, error: enrollment.error ?? 'no readable assignment' });
        return failed(MSG.unexpected);
      }
      if (enrollment.invalid) {
        this.#log('error', 'school.printed-activity.entry-invalid', { userId, corpusId, errors: enrollment.invalid });
      }
      if (!enrollment.entry) return failed(MSG.notAssigned);
      const { entry } = enrollment;
      const { platform: platformId, kind, paper } = entry.activity;

      const platform = this.#platforms.get(platformId);
      if (!platform) {
        this.#log('warn', 'school.printed-activity.platform-missing', { userId, corpusId, platform: platformId });
        return failed(MSG.platform);
      }
      if (!this.#printer || typeof this.#printer.printPdf !== 'function') {
        this.#log('warn', 'school.printed-activity.printer-missing', { userId, corpusId });
        return failed(MSG.noPrinter);
      }

      // One clock read: issuedAt and issuedStudyDay must name the same instant.
      const now = this.#clock();
      const studyDay = studyDayForInstant(now.getTime(), { timezone: this.#timezone });

      const mine = (await this.#store.listForLearner(userId) ?? []).filter((r) => r?.corpusId === entry.corpusId);
      const opens = mine.filter((r) => r.completedAt == null && r.voidedAt == null);
      if (opens.length > 1) {
        this.#log('warn', 'school.printed-activity.multiple-open', { userId, corpusId, issuanceIds: opens.map((r) => r.issuanceId) });
      }
      let reprint = opens.reduce((a, b) => (a == null || String(b.issuedAt ?? '') >= String(a.issuedAt ?? '') ? b : a), null);

      let reserved = null;
      let bytes = null;
      if (!reprint) {
        const r = await this.#reserve({ userId, entry, platform, now, studyDay });
        if (r.failed) return failed(r.failed);
        if (r.reprint) reprint = r.reprint;
        else ({ reserved, bytes } = r);
      }
      const page = reprint ?? reserved;
      if (reprint) {
        // A reprint of a sheet that just came out is a repeated ticket scan,
        // not a lost sheet; this is the only quota on it (see
        // DEFAULT_REPRINT_COOLDOWN_MS). It covers the double-scan path too.
        const lastPrintedAt = reprint.lastPrintedAt ?? reprint.issuedAt ?? null;
        const last = typeof lastPrintedAt === 'string' ? Date.parse(lastPrintedAt) : NaN;
        if (Number.isFinite(last) && now.getTime() - last < this.#reprintCooldownMs) {
          this.#log('info', 'school.printed-activity.reprint-cooldown', {
            userId, corpusId, issuanceId: reprint.issuanceId ?? null, externalId: page.externalId,
            lastPrintedAt, cooldownMs: this.#reprintCooldownMs,
          });
          return failed(MSG.justPrinted);
        }
        bytes = await this.#printable(platform, page.externalId, paper);
      }
      const title = page.title || this.#label(entry);

      let result;
      try {
        result = await this.#printer.printPdf(bytes, { jobName: `${userId} ${kind} ${page.externalId}`, user: userId, copies: 1 });
      } catch (err) {
        this.#log('warn', 'school.printed-activity.print-failed', {
          userId, corpusId, platform: platformId, externalId: page.externalId, reprint: Boolean(reprint), error: errText(err),
        });
        if (reserved) await this.#void(userId, reserved, now.toISOString(), 'print-failed');
        return failed(MSG.printFailed);
      }
      // `confirmed === false` is IssueDocument's dry-run signal: nothing came
      // out of the tray. See IssueDocument#printConfirmed.
      const confirmed = result?.confirmed !== false;
      if (!confirmed) {
        // Only a dry-run or virtual printer answers this; a real printer either
        // prints or throws. The answer stays `dispatched` because nothing
        // failed from where the child stands: the job was accepted, and on a
        // dry run there is no paper to wait for. The reservation is voided so
        // the log never names a page that does not exist.
        this.#log('info', 'school.printed-activity.unconfirmed', {
          learnerId: userId, corpusId, platform: platformId, externalId: page.externalId, reprint: Boolean(reprint),
        });
        if (reserved) await this.#void(userId, reserved, now.toISOString(), 'print-unconfirmed');
      } else {
        await this.#markPrinted(userId, page, now.toISOString());
      }

      this.#log('info', 'school.printed-activity.issued', {
        learnerId: userId, corpusId, platform: platformId, externalId: page.externalId, reprint: Boolean(reprint), confirmed,
      });
      return { decision: 'dispatched', message: `${title} is printing.` };
    } catch (err) {
      if (err instanceof PlatformFault) {
        this.#log('warn', 'school.printed-activity.platform-failed', { userId, corpusId, error: err.message });
        return failed(MSG.platform);
      }
      this.#log('error', 'school.printed-activity.launch-failed', { userId, corpusId, error: errText(err) });
      return failed(MSG.unexpected);
    }
  }
}

export default PrintedActivityProgramLauncher;
