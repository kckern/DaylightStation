import { parseBookIdentifier } from '#domains/books/BookIdentifier.mjs';

/**
 * BookEntryPolicy — may a child put THIS book on their own shelf?
 *
 * With `school.yml` `books.manualEntry: false` the answer is "only if the
 * barcode was scanned": the book must have been claimed from a scan by the
 * same learner a short while ago (`PrepareBookScan#hasScanned`). The pad
 * accepted any number that checksummed, and in September 2026 three quarters
 * of the readings children opened were one placeholder ISBN typed from
 * memory (`9780123456786`, the digits 0–9 in order) — credit for books nobody
 * held. A scan needs the book in hand.
 *
 * Only the child's add door is gated. Progress on a reading already on the
 * shelf, and the teacher console's own "open a book for a child", are not.
 * The flag is read on every call, so a config reload flips it without a
 * rebuild. An absent key keeps typing allowed.
 */
export class BookEntryPolicy {
  #manualEntryAllowed; #scanned; #logger;

  constructor({ manualEntryAllowed, scanned, logger = {} } = {}) {
    if (typeof manualEntryAllowed !== 'function') throw new TypeError('BookEntryPolicy requires manualEntryAllowed()');
    if (typeof scanned !== 'function') throw new TypeError('BookEntryPolicy requires scanned()');
    this.#manualEntryAllowed = manualEntryAllowed;
    this.#scanned = scanned;
    this.#logger = logger;
  }

  /** What the shelf tells the panel, so it can draw the right add door. */
  describe() {
    return { manual: this.#manualAllowed() };
  }

  /** Throws a 403 when the book may not be opened without a scan. */
  assertMayOpen({ learnerId, bookId }) {
    if (this.#manualAllowed()) return;
    const parsed = parseBookIdentifier(typeof bookId === 'string' ? bookId : '');
    const isbn13 = parsed.kind === 'isbn' ? parsed.isbn13 : null;
    if (isbn13 && this.#scanned({ learnerId, isbn13 })) return;
    this.#logger.warn?.('school.book-log.manual-entry-refused', { learnerId, bookId: bookId ?? null });
    const error = new Error('Scan the barcode on your book to add it.');
    error.name = 'AuthorizationError';
    error.status = 403;
    throw error;
  }

  #manualAllowed() {
    try { return this.#manualEntryAllowed() !== false; } catch { return false; }
  }
}

export default BookEntryPolicy;
