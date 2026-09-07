import { ValidationError } from '#domains/core/errors/index.mjs';
import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import {
  inferProgressMode, isDayKey, isBackdateAllowed, isPlausiblePage, MAX_BACKDATE_DAYS, shelfItemView,
} from '#domains/school/bookShelf.mjs';

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
 * `openedOn` IS ALWAYS TODAY, AND THAT IS THE FIX. v1 stamped a backdated
 * finish's `openedAt` to the chosen day — deliberately falsifying when the item
 * was opened — because one field had to carry both "when this happened" and
 * "when this was recorded", and credit had to land on the day the book was
 * read. v2 has both fields: the finish carries `finishedOn` and its entry
 * carries `on`, so the day gets its credit while the opening stays truthful.
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
      // THE SAME FLOOR AS `RecordBookProgress`, AND THIS IS THE DOOR THAT
      // MATTERS MORE. `finished` is how a book already read gets logged, so it
      // is the path a far-backdated entry actually takes; bounding only the
      // other use case would leave the hole wide open.
      if (!isBackdateAllowed(finishedOn, today)) {
        throw new ValidationError(`That day is more than ${MAX_BACKDATE_DAYS} days ago. Ask a grown-up.`);
      }
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

    // CHECKED HERE, NOT BESIDE THE OTHER `partway` GUARDS ABOVE. The book's
    // length is not known until `resolveBook` has answered, so the shape check
    // ("a positive page") and the plausibility check ("a page this book could
    // have") cannot sit together — the denominator does not exist yet at the
    // first one. A book that resolved without a pageCount has no ceiling, which
    // is the ordinary case on this door (see `isPlausiblePage`).
    if (where === 'partway' && !isPlausiblePage(page, book.pageCount)) {
      throw new ValidationError('That page number is too big for this book.');
    }

    let reading = await this.#bookLog.openReading({
      learnerId, isbn: book.isbn13 ?? bookId, idempotencyKey: entryId, openedOn: today,
      progressMode, pageCount: book.pageCount ?? null,
    });

    let event = null;
    if (where === 'partway') {
      event = await this.#bookLog.appendEntry({
        learnerId, readingId: reading.id, on: today, at: now, page,
        source: 'panel', idempotencyKey: progressEntryId,
      });
    } else if (where === 'finished') {
      // The EVIDENCE first, then the decision. Interrupted between the two, the
      // shelf under-reports a book as still being read — which a child can fix
      // by finishing it again. The other order would claim a finish with
      // nothing behind it.
      event = await this.#bookLog.appendEntry({
        learnerId, readingId: reading.id, on: finishedOn, at: now,
        source: 'panel', idempotencyKey: progressEntryId,
      });
      reading = await this.#bookLog.updateReading({
        learnerId, readingId: reading.id, patch: { status: 'finished', finishedOn },
      });
    }

    const item = { ...reading, ...shelfItemView(reading) };
    this.#logger.info?.('school.book-shelf.item-opened', {
      learnerId, bookId: item.bookId, where, progressMode: item.progressMode,
      metadata: resolved.status === 'ok' ? 'resolved' : 'pending',
    });
    return { item, event, book };
  }
}
export default OpenBookShelfItem;
