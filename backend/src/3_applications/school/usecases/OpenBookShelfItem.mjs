import { ValidationError } from '#domains/core/errors/index.mjs';
import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { inferProgressMode, isDayKey, noonOf } from '#domains/school/bookShelf.mjs';

const WHERE = new Set(['starting', 'partway', 'finished']);

/**
 * OpenBookShelfItem — a confirmed book joins a learner's shelf.
 *
 * The three doors of the add flow (design §5 step 3) each need exactly one
 * thing: `starting` needs nothing, `partway` needs a page, `finished` needs a
 * day. Two entryIds travel with the request — one for the `started` event the
 * store writes on open, one for the optional first event — because the store
 * dedupes on entryId per item and a shared id drops the second event (review M1).
 *
 * `openedAt` is NOW for `starting` and `partway` — those are happening now.
 * For `finished` it is noon of the chosen day, so the whole item — the store's
 * `started` event and the `finished` event alike — lives on the day the book
 * was read, and credit goes to that day rather than to today (design §5 step
 * 3). Safe since `itemId` no longer derives from `openedAt`.
 *
 * "Not in the future" is judged on the HOUSEHOLD STUDY DAY — `dayOf(now)`,
 * the launcher's 4am-boundary day, injected the way `GetBookShelf` receives
 * it — never on the UTC date (review m1; see RecordBookProgress).
 */
export class OpenBookShelfItem {
  #bookLog; #resolveBook; #clock; #dayOf; #logger;
  constructor({ bookLog, resolveBook, clock = () => new Date(), dayOf, logger = console } = {}) {
    if (!bookLog) throw new Error('OpenBookShelfItem requires a bookLog');
    if (!resolveBook) throw new Error('OpenBookShelfItem requires resolveBook');
    if (typeof dayOf !== 'function') throw new Error('OpenBookShelfItem requires dayOf');
    this.#bookLog = bookLog; this.#resolveBook = resolveBook; this.#clock = clock; this.#dayOf = dayOf; this.#logger = logger;
  }

  async execute({ learnerId, bookId, entryId, where = 'starting', page = null, finishedOn = null, progressEntryId = null } = {}) {
    const now = this.#clock().toISOString();
    const today = this.#dayOf(now);
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    if (typeof bookId !== 'string' || !bookId) throw new ValidationError('bookId is required');
    if (typeof entryId !== 'string' || !entryId) throw new ValidationError('entryId is required');
    if (!WHERE.has(where)) throw new ValidationError(`where must be starting|partway|finished, got: ${where}`);
    if (page !== null && where !== 'partway') throw new ValidationError('page only applies to partway');
    if (finishedOn !== null && where !== 'finished') throw new ValidationError('finishedOn only applies to finished');

    if (where !== 'starting') {
      if (typeof progressEntryId !== 'string' || !progressEntryId) throw new ValidationError('progressEntryId is required for partway/finished');
      if (progressEntryId === entryId) throw new ValidationError('progressEntryId must differ from entryId');
    }
    if (where === 'partway' && !(Number.isInteger(page) && page > 0)) throw new ValidationError('partway requires a positive page');

    if (where === 'finished') {
      if (!isDayKey(finishedOn)) throw new ValidationError('finished requires finishedOn as a real day, YYYY-MM-DD');
      if (finishedOn > today) throw new ValidationError('finishedOn cannot be in the future');
    }

    const resolved = await this.#resolveBook.execute(bookId);
    let book = resolved.status === 'ok' ? (resolved.book ?? null) : null;
    if (resolved.status === 'not-found') {
      // A clean provider miss is not evidence that the physical book in the
      // child's hands does not exist. Keep the checksum-validated ISBN as a
      // truthful minimal record; later catalog resolution can fill the shelf
      // presentation without rewriting reading evidence. Outages and invalid
      // identifiers still fail, because they are not clean misses.
      const identifier = parseBookIdentifier(bookId);
      if (identifier.kind === 'isbn') {
        book = createBookRecord({ source: 'unresolved-isbn', isbn13: identifier.isbn13 });
      }
    }
    if (resolved.status !== 'ok' && !book) {
      throw new ValidationError(`book ${bookId} did not resolve: ${resolved.status}`);
    }
    // The child explicitly supplied a physical page on the partway door.
    // That is stronger evidence for page mode than a provider's missing page
    // count is for check mode. Keep the page even without a denominator; the
    // UI can show `p. 84` without drawing a percentage bar.
    const progressMode = where === 'partway' ? 'page' : inferProgressMode(book);

    // A backdated finish lives ENTIRELY on the day it was finished. The store
    // stamps the `started` event at `openedAt`. `started` is deliberately not
    // reading evidence, but co-locating the item's opening and finish still
    // gives the append-only record one honest historical origin instead of a
    // misleading "opened today, finished last week" pair. `starting` and
    // `partway` are genuinely happening now.
    const openedAt = where === 'finished' ? noonOf(finishedOn) : now;
    const item = await this.#bookLog.openItem({
      learnerId, bookId: book.isbn13 ?? bookId, entryId, openedAt,
      progressMode, pageCount: book.pageCount ?? null,
    });

    let event = null;
    if (where === 'partway') {
      event = await this.#bookLog.appendEvent({ itemId: item.itemId, kind: 'progress', at: openedAt, page, entryId: progressEntryId });
    } else if (where === 'finished') {
      event = await this.#bookLog.appendEvent({ itemId: item.itemId, kind: 'finished', at: noonOf(finishedOn), entryId: progressEntryId });
    }

    this.#logger.info?.('school.book-shelf.item-opened', {
      learnerId, bookId: item.bookId, where, progressMode: item.progressMode,
      metadata: resolved.status === 'ok' ? 'resolved' : 'pending',
    });
    return { item, event, book };
  }
}
export default OpenBookShelfItem;
