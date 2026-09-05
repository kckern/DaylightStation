/**
 * BookLogProgramLauncher — the `IProgramLauncher` for the reading shelf.
 *
 * ## THE SHELF DOES NOT NEED THIS FILE; THE AGENDA DOES
 *
 * The shelf works with no enrollment at all: look a book up, log pages, finish
 * it. This launcher exists only so that a shelf which HAS an obligation can
 * appear on the daily agenda, and it reads the same store the shelf writes.
 * Nothing below the seam knows an obligation exists — `bookShelf.mjs` measures
 * whatever it is handed and has no idea where the number came from.
 *
 * ## `doneToday` MEANS "NOTHING OWED TODAY"
 *
 * For a `day` window that is literal. For `week`, `month` and `once` it means
 * the target is already met, so nothing is owed right now. A weekly target read
 * as unmet on six days out of seven would put a permanent red tile on the board
 * for a child who is perfectly on track — which is worse than useless, because
 * it teaches everyone to ignore the colour.
 *
 * ## ONLY `once` CAN BE TERMINAL
 *
 * A finished series leaves the agenda, exactly as a `cadence: 'once'` program
 * does. Daily and weekly obligations are never terminal: tomorrow they ask
 * again, as story-time does.
 *
 * ## THREE ANSWERS, NOT TWO
 *
 * Enrolled, not enrolled, and UNREADABLE are distinguishable — the same care
 * `StoryTimeProgramLauncher` takes. An unreadable shelf is `error: true`, never
 * a zero, because a false zero shows a child who read four books as owing four
 * books and nothing anywhere reports it.
 *
 * @module applications/school/BookLogProgramLauncher
 */
import { BOOK_LOG_PROGRAM_ID } from '#domains/school/bookLog.mjs';
import { measureObligation, projectShelfItem } from '#domains/school/bookShelf.mjs';
import { studyDayForInstant } from '#domains/school/studyDay.mjs';

/** Where a child does this, in the words a child reads. */
const ON_THE_PANEL = 'on the school panel';

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` shifted by whole days, without touching local time. */
function shiftDay(studyDay, days) {
  const at = Date.parse(`${studyDay}T00:00:00.000Z`);
  if (!Number.isFinite(at)) return studyDay;
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The window an obligation is measured over, ending on the current study day.
 * `once` is unbounded at the start: cumulative since the enrollment began.
 */
export function obligationWindow(per, studyDay) {
  if (per === 'once') return { from: null, to: studyDay };
  if (per === 'week') return { from: shiftDay(studyDay, -6), to: studyDay };
  if (per === 'month') return { from: shiftDay(studyDay, -29), to: studyDay };
  return { from: studyDay, to: studyDay };
}

export class BookLogProgramLauncher {
  #assignments; #bookLog; #timezone; #clock; #logger; #grants;

  constructor({ assignments, bookLog, timezone = null, clock = () => new Date(), logger = console, grants = null } = {}) {
    if (!assignments || typeof assignments.get !== 'function') {
      throw new Error('BookLogProgramLauncher requires an assignments store with get(learnerId)');
    }
    if (!bookLog) throw new Error('BookLogProgramLauncher requires a bookLog store');
    this.#assignments = assignments;
    this.#bookLog = bookLog;
    this.#timezone = timezone;
    this.#clock = clock;
    this.#logger = logger;
    this.#grants = grants;
  }

  get id() { return BOOK_LOG_PROGRAM_ID; }

  get locationHint() { return ON_THE_PANEL; }

  /** The panel hosts the shelf; DoNow can dispatch a child there. */
  get surface() { return 'portal'; }

  /** The single place the household's 4am boundary is applied for this program. */
  studyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone });
  }

  /**
   * THE one day function for this program. Every reader of the shelf — the
   * agenda through `status()`, the shelf route through its projection — must
   * count days with this, or the agenda and the card disagree on `daysRead`
   * for the same child. Applies the household's 4am boundary and timezone;
   * answers `''` for anything unparseable, which `inWindow` rejects.
   */
  dayOf(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? studyDayForInstant(ms, { timezone: this.#timezone }) : '';
  }

  /**
   * The shape `collectProgramStatuses` calls every launcher with. A bare
   * string is refused rather than looked up: on the old string shape a live
   * agenda call would have found nothing and reported a child as NOT
   * ENROLLED, which nothing anywhere would have flagged.
   *
   * @param {{userId: string, programInstance?: string|null}} args —
   *   `programInstance` is accepted and ignored; there is one shelf per learner.
   * @returns {Promise<object>} the shape `planDailyAgenda` consumes
   */
  async status({ userId } = {}) {
    const learnerId = userId;
    if (typeof learnerId !== 'string' || !learnerId) throw new TypeError('BookLogProgramLauncher.status takes { userId }');
    let enrollment;
    try {
      const assignment = await this.#assignments.get(learnerId);
      enrollment = (Array.isArray(assignment?.programs) ? assignment.programs : [])
        .find((entry) => entry?.programId === BOOK_LOG_PROGRAM_ID) ?? null;
    } catch (error) {
      this.#logger.warn?.('school.book-log.assignments-unreadable', { learnerId, error: error.message });
      return this.#unreadable();
    }

    if (!enrollment) {
      return { enrolled: false, error: false, doneToday: true, terminal: false, progressLabel: null, score: null };
    }

    let items;
    try {
      items = (await this.#bookLog.listForLearner(learnerId)) ?? [];
    } catch (error) {
      this.#logger.warn?.('school.book-log.shelf-unreadable', { learnerId, error: error.message });
      return this.#unreadable();
    }

    const obligation = enrollment.obligation ?? null;
    const window = obligation ? obligationWindow(obligation.per, this.studyDay()) : null;
    const dayOf = (iso) => this.dayOf(iso);
    const measured = measureObligation(obligation, items, window, { dayOf });
    const projections = items.map((entry) => projectShelfItem(entry, { dayOf }));
    const reading = projections.filter((view) => view.status === 'reading').length;
    const finished = projections.filter((view) => view.status === 'finished').length;

    return {
      enrolled: true,
      error: false,
      // `null`, not `true`, when nothing is owed. The agenda treats `true` as
      // "subject served" (agenda.mjs:259), which closed the shelf to a child
      // with no target and hid every other English unit behind it.
      doneToday: obligation ? measured.met : null,
      // Only a cumulative target can ever be finished for good.
      terminal: Boolean(obligation) && obligation.per === 'once' && measured.met,
      // The shelf's obligation line adds the window word (`today`, `this
      // week`) client-side; `per` rides along so it can.
      obligationProgress: obligation ? { ...measured, per: obligation.per } : null,
      progressLabel: this.#label({ obligation, measured, reading, finished }),
      // A shelf is not graded. `null` is the honest answer, and the agenda
      // already understands it (a language ladder does not grade either).
      score: null,
      reading,
      finished,
    };
  }

  /**
   * There is nowhere to dispatch to yet — the shelf is a panel surface a child
   * walks up to. Refusing truthfully beats mounting a screen that is not there.
   */
  async launch() {
    return { ok: false, reason: `Your books are ${ON_THE_PANEL}.` };
  }

  /**
   * The signed handoff the panel mounts the shelf with (`RunSelfServiceAction`
   * spreads this into the mount effect). Routes verify `bookGrant` per request
   * and take the learner from it — never from the client (design §2). Same
   * pattern as `RubiksCubeProgramLauncher.issueLaunchTarget`.
   */
  issueLaunchTarget({ userId } = {}) {
    if (!this.#grants) throw new Error('BookLogProgramLauncher cannot issue a launch target without a grants issuer');
    return { kind: 'program', program: this.id, learnerId: userId, bookGrant: this.#grants.issue({ learnerId: userId }) };
  }

  #unreadable() {
    return {
      enrolled: null, error: true, doneToday: false, terminal: false,
      progressLabel: null, score: null, obligationProgress: null,
    };
  }

  #label({ obligation, measured, reading, finished }) {
    if (!obligation) {
      if (reading === 0 && finished === 0) return 'No books yet';
      const parts = [];
      if (reading) parts.push(`${reading} reading`);
      if (finished) parts.push(`${finished} finished`);
      return parts.join(' · ');
    }
    const unit = obligation.metric === 'checkins' ? 'check-in' : obligation.metric.replace(/s$/, '');
    const plural = measured.target === 1 ? unit : `${unit}s`;
    const scope = obligation.scope?.label ? ` of ${obligation.scope.label}` : '';
    return `${measured.actual} of ${measured.target} ${plural}${scope}`;
  }
}

export default BookLogProgramLauncher;
