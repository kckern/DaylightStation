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
 * Like story time there is no course: `doneToday` is completed sheets on the
 * study day against the entry's `target`, and the program is never terminal.
 * An unreadable enrollment or log is `error: true`, never a false zero; not
 * enrolled is `error: false, enrolled: false`.
 *
 * Application layer: the clock and the rng are injected (no ambient time or
 * randomness), and the store's `PageAlreadyOpenError` is recognised by its
 * `code`, so this file never imports the adapter that defines it.
 */
import { studyDayForInstant } from '../domain/studyDay.mjs';
import {
  PRINTED_ACTIVITY_PROGRAM_ID, servedUnitId, validatePrintedActivityEnrollment
} from '../domain/printedActivity.mjs';

const capitalise = (s) => (typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : s);
const errText = (err) => err?.message ?? String(err);

export class PrintedActivityProgramLauncher {
  #assignments; #store; #platforms; #printer; #timezone; #clock; #rng; #logger;

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
   */
  constructor({ assignments, store, platforms = new Map(), printer = null, timezone = null, clock, rng, logger } = {}) {
    if (!assignments) throw new Error('PrintedActivityProgramLauncher requires an assignments store');
    if (!store) throw new Error('PrintedActivityProgramLauncher requires a printed-activity store');
    if (typeof clock !== 'function') throw new Error('PrintedActivityProgramLauncher requires a clock');
    if (typeof rng !== 'function') throw new Error('PrintedActivityProgramLauncher requires an rng');
    if (!logger) throw new Error('PrintedActivityProgramLauncher requires a logger');
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

  #unavailable(enrolled = null) {
    return {
      error: true, enrolled, doneToday: false, progressLabel: 'Printed activity unavailable',
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
    return entry.title ?? capitalise(entry.activity.kind);
  }

  async status({ userId, programInstance = null, day = null }) {
    const studyDay = day ?? this.studyDay();
    let enrollment;
    try {
      enrollment = await this.#enrollmentFor(userId, programInstance);
    } catch (err) {
      this.#logger.error?.('school.printed-activity.enrollment-unreadable', { userId, corpusId: programInstance, error: errText(err) });
      return this.#unavailable();
    }
    if (enrollment.unreadable) {
      this.#logger.error?.('school.printed-activity.enrollment-unreadable', { userId, corpusId: programInstance, reason: 'no readable assignment' });
      return this.#unavailable();
    }
    if (!enrollment.enrolled) return this.#notEnrolled();
    if (enrollment.invalid) {
      this.#logger.error?.('school.printed-activity.entry-invalid', { userId, corpusId: programInstance, errors: enrollment.invalid });
      return this.#unavailable(true);
    }
    const { entry } = enrollment;
    let rows;
    try {
      rows = await this.#store.listCompletedForDay(userId, entry.corpusId, studyDay);
    } catch (err) {
      this.#logger.error?.('school.printed-activity.log-unreadable', { userId, corpusId: entry.corpusId, day: studyDay, error: errText(err) });
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

  /** Printing arrives in the next change; until then the launcher refuses honestly. */
  async launch() {
    return { decision: 'failed', message: 'Worksheets are unavailable right now. Ask a grown-up.' };
  }
}

export default PrintedActivityProgramLauncher;
