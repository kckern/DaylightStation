/**
 * IBookRepository — the household's durable cache of resolved book records.
 *
 * A REPOSITORY, not an expiring cache. Household reading repeats heavily —
 * siblings, re-reads — and a cached record means an OpenLibrary outage cannot
 * stop a child logging a book the house has seen before. Freshness metadata
 * lets `ResolveBook` refresh stale facts in the background, while the known
 * record remains immediately usable and is never expired out from under a
 * shelf item that points at it. Explicit refresh remains the awaited repair
 * path (`ResolveBook.execute(id, { refresh: true })`).
 *
 * Keyed by canonical ISBN-13 (PRD B3). Book facts are not private: one cache
 * serves every learner in the household (PRD decision 6).
 *
 * Layer: APPLICATION port (3_applications/books/ports).
 *
 * @module applications/books/ports/IBookRepository
 */

/** @typedef {import('#domains/books/BookRecord.mjs').BookRecord} BookRecord */

export class IBookRepository {
  /**
   * @param {string} isbn13
   * @returns {Promise<BookRecord|null>} a frozen, complete `BookRecord`, or null
   *   when unknown OR unreadable — a reader never throws; a corrupt file is
   *   logged and treated as absent so a lookup can refetch over it.
   */
  async findByIsbn() { throw new Error('IBookRepository.findByIsbn not implemented'); }

  /**
   * Optional freshness-aware read. Repositories that persist cache metadata
   * return it without leaking that metadata into `BookRecord`.
   * @returns {Promise<{book: BookRecord, cachedAt: string|null}|null>}
   */
  async findByIsbnEntry(isbn13) {
    const book = await this.findByIsbn(isbn13);
    return book ? { book, cachedAt: null } : null;
  }

  /**
   * Replace (never merge) the record for its `isbn13`.
   * @param {BookRecord} record - from `createBookRecord`/`mergeBookRecords`
   * @returns {Promise<BookRecord>} the stored record
   */
  async save() { throw new Error('IBookRepository.save not implemented'); }
}

export default IBookRepository;
