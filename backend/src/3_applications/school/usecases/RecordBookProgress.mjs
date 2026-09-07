import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  PROGRESS_MODES, isDayKey, isBackdateAllowed, isPlausiblePage, MAX_BACKDATE_DAYS, shelfItemView,
} from '#domains/school/bookShelf.mjs';

const KINDS = new Set(['progress', 'finished', 'reopened', 'set-aside']);

/**
 * RecordBookProgress — one event on a book already on the shelf.
 *
 * The field a child may supply is decided by the item's `progressMode`:
 * `page` takes a page, `minutes` takes minutes, `check` takes nothing. A
 * mismatch is refused rather than dropped, because a page on a check-mode book
 * would count toward nothing and nobody would know (PRD A4).
 *
 * A backdated `finishedOn` may not be in the future, and "the future" is
 * judged on the HOUSEHOLD STUDY DAY — `dayOf(now)`, the launcher's 4am-
 * boundary day, injected the way `GetBookShelf` receives it — never on the
 * UTC date. East of UTC the UTC date refused "Today" at 06:00 local; west of
 * it, it accepted tomorrow after ~5pm (review m1).
 *
 * ## THREE OF THE FOUR KINDS ARE NOW STATE, NOT EVIDENCE
 *
 * `finished`, `reopened` and `set-aside` set `status` (and `finishedOn`)
 * instead of appending an event whose POSITION in a list implied a state. Only
 * `progress` — and the day a finish happened — is evidence. The wire shape the
 * panel sends is unchanged; what the store does with it is not.
 */
export class RecordBookProgress {
  #bookLog; #clock; #dayOf; #logger;
  constructor({ bookLog, clock = () => new Date(), dayOf, logger = console } = {}) {
    if (!bookLog) throw new Error('RecordBookProgress requires a bookLog');
    if (typeof dayOf !== 'function') throw new Error('RecordBookProgress requires dayOf');
    this.#bookLog = bookLog; this.#clock = clock; this.#dayOf = dayOf; this.#logger = logger;
  }

  /**
   * The reading this learner owns, or a refusal.
   *
   * Ownership is checked by LOOKING, not by reading a learner out of the id.
   * The id names nothing; the shelf it was found on is what says whose it is.
   */
  async #owned(learnerId, itemId) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const readings = await this.#bookLog.listForLearner(learnerId);
    const reading = readings.find((entry) => shelfItemView(entry).itemId === itemId);
    if (!reading) throw new ValidationError(`item ${itemId} is not on this learner's shelf`);
    return reading;
  }

  async execute({ learnerId, itemId, kind, page = null, minutes = null, finishedOn = null, note = null, rating = null, entryId } = {}) {
    if (!KINDS.has(kind)) throw new ValidationError(`kind must be progress|finished|reopened|set-aside, got: ${kind}`);
    if (typeof entryId !== 'string' || !entryId) throw new ValidationError('entryId is required');
    if (finishedOn !== null && kind !== 'finished') throw new ValidationError('finishedOn only applies to a finished event');
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new ValidationError('rating must be an integer from 1 to 5');
    const reading = await this.#owned(learnerId, itemId);
    const view = shelfItemView(reading);

    if (page !== null && view.progressMode !== 'page') throw new ValidationError(`page is not accepted in ${view.progressMode} mode`);
    if (minutes !== null && view.progressMode !== 'minutes') throw new ValidationError(`minutes is not accepted in ${view.progressMode} mode`);
    if (page !== null && !(Number.isInteger(page) && page > 0)) throw new ValidationError('page must be a positive integer');
    // A ceiling, not an equality — see `isPlausiblePage`. A book with no known
    // length has no ceiling at all, which is the ordinary case, not the edge.
    if (page !== null && !isPlausiblePage(page, view.pageCount)) {
      throw new ValidationError('That page number is too big for this book.');
    }
    if (minutes !== null && !(Number.isInteger(minutes) && minutes > 0)) throw new ValidationError('minutes must be a positive integer');
    if (kind !== 'progress' && (page !== null || minutes !== null)) {
      throw new ValidationError('page and minutes only apply to a progress event');
    }
    if (kind === 'progress') {
      if (view.progressMode === 'page' && page === null) {
        throw new ValidationError('page mode requires a page');
      }
      if (view.progressMode === 'minutes' && minutes === null) {
        throw new ValidationError('minutes mode requires minutes');
      }
      if (view.progressMode === 'check' && (page !== null || minutes !== null)) {
        throw new ValidationError('check mode takes no page or minutes');
      }
    }

    const at = this.#clock().toISOString();
    const today = this.#dayOf(at);
    let on = today;
    if (kind === 'finished' && finishedOn !== null) {
      if (!isDayKey(finishedOn)) throw new ValidationError('finishedOn must be a real day, YYYY-MM-DD');
      if (finishedOn > today) throw new ValidationError('finishedOn cannot be in the future');
      // The past needs a floor too. Unbounded, a book started today could be
      // stamped weeks back and drop credit into a reported period — observed
      // 2026-09-06, eighteen days. Kept as a SEPARATE check from the future one
      // so the child is told which end they are past.
      if (!isBackdateAllowed(finishedOn, today)) {
        throw new ValidationError(`That day is more than ${MAX_BACKDATE_DAYS} days ago. Ask a grown-up.`);
      }
      on = finishedOn;
    }

    let event = null;
    let updated = reading;
    if (kind === 'progress' || kind === 'finished') {
      event = await this.#bookLog.appendEntry({
        learnerId, readingId: view.itemId, on, at,
        ...(page !== null ? { page } : {}),
        ...(minutes !== null ? { minutes } : {}),
        ...(note !== null ? { note } : {}),
        ...(rating !== null ? { rating } : {}),
        source: 'panel', idempotencyKey: entryId,
      });
    }

    const patch = this.#statePatch(kind, reading, on);
    if (patch) {
      updated = await this.#bookLog.updateReading({ learnerId, readingId: view.itemId, patch });
    }
    if (kind === 'reopened') {
      await this.#withdrawFinishCredit(learnerId, reading);
    }

    this.#logger.info?.('school.book-shelf.progress', { learnerId, itemId, kind, mode: view.progressMode });
    return { item: { ...updated, ...shelfItemView(updated) }, event };
  }

  /**
   * The state change a kind means, or null when it means none.
   *
   * `progress` on a book that was set aside resumes it — the child picking it
   * back up IS the declaration, and it is made at write time where somebody
   * chose it, not re-derived on every read from where the row landed. A
   * finished book stays finished: logging a page in a book you have finished
   * does not un-finish it, exactly as before.
   *
   * `reopened` clears the finish; `#withdrawFinishCredit` then removes what the
   * finish put on the log. Undo has to take back today's check-in credit as
   * well as the completion — a child who mis-tapped "I finished it" and undid
   * it did not thereby read that day.
   */
  #statePatch(kind, reading, on) {
    if (kind === 'finished') return { status: 'finished', finishedOn: on };
    if (kind === 'reopened') return { status: 'reading', finishedOn: null };
    if (kind === 'set-aside') return { status: 'set-aside' };
    if (kind === 'progress' && reading.status === 'set-aside') return { status: 'reading' };
    return null;
  }

  /**
   * Take back the row a finish wrote.
   *
   * A finish leaves TWO marks: the state, and one dated row on the day it
   * happened — which is what makes the finish day count as a day read, exactly
   * as the v1 log did. Clearing only the state would leave a check-in behind
   * for a day the child took back, and the undo receipt promises otherwise.
   *
   * The row is found by shape: on the finish day, carrying neither a page nor
   * minutes. That is what a finish writes and nothing else does, except a bare
   * check-in on the same day — and removing either one withdraws exactly one
   * day's credit, which is the outcome the undo owes.
   *
   * State is cleared FIRST by the caller: interrupted between the two, the
   * shelf shows a book still being read with one row too many, rather than a
   * finish with nothing behind it.
   */
  async #withdrawFinishCredit(learnerId, reading) {
    if (reading.status !== 'finished') return;
    const written = (reading.entries ?? []).filter((entry) => entry
      && entry.on === reading.finishedOn
      && entry.page === undefined && entry.minutes === undefined);
    const target = written.at(-1);
    if (!target?.id) return;
    await this.#bookLog.deleteEntry({ learnerId, readingId: reading.id, entryId: target.id });
  }

  async setMode({ learnerId, itemId, progressMode } = {}) {
    if (!PROGRESS_MODES.includes(progressMode)) throw new ValidationError(`progressMode must be one of ${PROGRESS_MODES.join('|')}`);
    await this.#owned(learnerId, itemId);
    const updated = await this.#bookLog.updateReading({ learnerId, readingId: itemId, patch: { progressMode } });
    this.#logger.info?.('school.book-shelf.mode-switched', { learnerId, itemId, progressMode });
    return { ...updated, ...shelfItemView(updated) };
  }
}
export default RecordBookProgress;
