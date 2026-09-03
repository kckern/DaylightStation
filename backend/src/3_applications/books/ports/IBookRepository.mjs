/**
 * IBookRepository — the household's durable cache of resolved book records.
 *
 * A REPOSITORY, not a TTL cache. Household reading repeats heavily — siblings,
 * re-reads — and a cached record means an OpenLibrary outage cannot stop a
 * child logging a book the house has seen before. Records are refreshed on
 * demand (`ResolveBook.execute(id, { refresh: true })`) and never expired out
 * from under a shelf item that points at them.
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
   * Replace (never merge) the record for its `isbn13`.
   * @param {BookRecord} record - from `createBookRecord`/`mergeBookRecords`
   * @returns {Promise<BookRecord>} the stored record
   */
  async save() { throw new Error('IBookRepository.save not implemented'); }
}

export default IBookRepository;
