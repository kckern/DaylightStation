import { ValidationError } from '#domains/core/errors/index.mjs';
import { PROGRESS_MODES, isDayKey, noonOf } from '#domains/school/bookShelf.mjs';

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
 */
export class RecordBookProgress {
  #bookLog; #clock; #dayOf; #logger;
  constructor({ bookLog, clock = () => new Date(), dayOf, logger = console } = {}) {
    if (!bookLog) throw new Error('RecordBookProgress requires a bookLog');
    if (typeof dayOf !== 'function') throw new Error('RecordBookProgress requires dayOf');
    this.#bookLog = bookLog; this.#clock = clock; this.#dayOf = dayOf; this.#logger = logger;
  }

  async #owned(learnerId, itemId) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof itemId !== 'string' || !itemId) throw new ValidationError('itemId is required');
    const items = await this.#bookLog.listForLearner(learnerId);
    const item = items.find((entry) => entry.itemId === itemId);
    if (!item) throw new ValidationError(`item ${itemId} is not on this learner's shelf`);
    return item;
  }

  async execute({ learnerId, itemId, kind, page = null, minutes = null, finishedOn = null, note = null, rating = null, entryId } = {}) {
    if (!KINDS.has(kind)) throw new ValidationError(`kind must be progress|finished|reopened|set-aside, got: ${kind}`);
    if (typeof entryId !== 'string' || !entryId) throw new ValidationError('entryId is required');
    if (finishedOn !== null && kind !== 'finished') throw new ValidationError('finishedOn only applies to a finished event');
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new ValidationError('rating must be an integer from 1 to 5');
    const item = await this.#owned(learnerId, itemId);

    if (page !== null && item.progressMode !== 'page') throw new ValidationError(`page is not accepted in ${item.progressMode} mode`);
    if (minutes !== null && item.progressMode !== 'minutes') throw new ValidationError(`minutes is not accepted in ${item.progressMode} mode`);
    if (page !== null && !(Number.isInteger(page) && page > 0)) throw new ValidationError('page must be a positive integer');
    if (minutes !== null && !(Number.isInteger(minutes) && minutes > 0)) throw new ValidationError('minutes must be a positive integer');
    if (kind !== 'progress' && (page !== null || minutes !== null)) {
      throw new ValidationError('page and minutes only apply to a progress event');
    }
    if (kind === 'progress') {
      if (item.progressMode === 'page' && page === null) {
        throw new ValidationError('page mode requires a page');
      }
      if (item.progressMode === 'minutes' && minutes === null) {
        throw new ValidationError('minutes mode requires minutes');
      }
      if (item.progressMode === 'check' && (page !== null || minutes !== null)) {
        throw new ValidationError('check mode takes no page or minutes');
      }
    }

    let at = this.#clock().toISOString();
    if (kind === 'finished' && finishedOn !== null) {
      if (!isDayKey(finishedOn)) throw new ValidationError('finishedOn must be a real day, YYYY-MM-DD');
      if (finishedOn > this.#dayOf(at)) throw new ValidationError('finishedOn cannot be in the future');
      at = noonOf(finishedOn);
    }

    const event = await this.#bookLog.appendEvent({
      itemId, kind, at, entryId,
      ...(page !== null ? { page } : {}),
      ...(minutes !== null ? { minutes } : {}),
      ...(note !== null ? { note } : {}),
      ...(rating !== null ? { rating } : {}),
    });
    this.#logger.info?.('school.book-shelf.progress', { learnerId, itemId, kind, mode: item.progressMode });
    return { item, event };
  }

  async setMode({ learnerId, itemId, progressMode } = {}) {
    if (!PROGRESS_MODES.includes(progressMode)) throw new ValidationError(`progressMode must be one of ${PROGRESS_MODES.join('|')}`);
    await this.#owned(learnerId, itemId);
    const item = await this.#bookLog.setProgressMode({ itemId, progressMode });
    this.#logger.info?.('school.book-shelf.mode-switched', { learnerId, itemId, progressMode });
    return item;
  }
}
export default RecordBookProgress;
