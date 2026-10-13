/**
 * IBookLogStore — durable evidence of what a learner actually read.
 *
 * Records, not runtime: a report card is reconstructed from this, so it lives
 * under `school/records/` and is never pruned by a cooldown or a session close.
 * Same rule `IReadingLogStore` holds, for the same reason.
 *
 * ## THE UNIT IS A READING, NOT A BOOK
 *
 * One reading is one child's pass through one book, at one time. The learner,
 * the book and the days are FIELDS of it; its `id` is opaque and names none of
 * them. That is what makes correcting a mis-scanned ISBN an edit, moving a book
 * to the sibling who actually read it a field write, and two passes through the
 * same book two records with two histories rather than one row with a UUID tail.
 *
 * ## EVERY WRITE NAMES ITS LEARNER
 *
 * No implementation may derive the learner from an id. The v1 adapter parsed
 * `<learner>:<book>:<entryId>` to choose which file to write, which is exactly
 * why a move was impossible. `learnerId` is a required argument on every write.
 *
 * ## SHARDED BY LEARNER, NOT BY DAY
 *
 * `IReadingLogStore` shards by study day because a daily count is asked about
 * one day at a time. A book is the opposite shape: it spans days, and every
 * question worth asking ("what is on this child's shelf", "how far into it are
 * they", "what have they finished this month") is a question about a LEARNER
 * across time.
 *
 * ## STATUS IS STORED; EVERYTHING MEASURED IS DERIVED
 *
 * `status` and `finishedOn` are stored, because a lifecycle state is a DECISION
 * somebody declares. Furthest page, percentage, days read and last-touched stay
 * derived by `projectReading` on every read — a stored measurement is a second
 * copy of the truth that can disagree with the evidence it came from.
 *
 * ## IDEMPOTENT ON THE CLIENT'S KEY
 *
 * The caller mints one key per recorded action and may send it more than once —
 * a retried POST, a remounted screen. A duplicate finish is a duplicate BOOK
 * against an obligation, so an implementation MUST return the existing record
 * unchanged rather than writing a second. The key dedupes and does nothing
 * else; it no longer names what it created.
 *
 * @module applications/school/ports/IBookLogStore
 */
export class IBookLogStore {
  /**
   * Open a reading, or return the one this key already opened.
   *
   * @param {{learnerId: string, isbn: string, idempotencyKey: string,
   *          openedOn?: string, progressMode?: 'page'|'minutes'|'check',
   *          pageCount?: number|null}} reading
   * @returns {Promise<object>} the stored reading
   */
  async openReading() { throw new Error('IBookLogStore.openReading not implemented'); }

  /**
   * Append one dated row of evidence.
   *
   * `on` is the study DAY it happened; `at` is the instant it was RECORDED.
   * They are separate because a child logging on Sunday that they read on
   * Friday is stating two different facts.
   *
   * @param {{learnerId: string, readingId: string, on: string, at?: string,
   *          page?: number|null, minutes?: number|null, note?: string|null,
   *          rating?: number|null, source?: string, externalId?: string|null,
   *          idempotencyKey?: string|null}} entry
   * @returns {Promise<object>} the stored entry — the existing one on a repeat
   */
  async appendEntry() { throw new Error('IBookLogStore.appendEntry not implemented'); }

  /**
   * Set fields on a reading — its state, its book, its mode, its days.
   * Never rewrites evidence: a book logged by page and then switched to
   * `check` keeps its pages (S6c).
   *
   * @param {{learnerId: string, readingId: string, patch: object, revision?: object|null}} change
   * @returns {Promise<object>} the updated reading
   */
  async updateReading() { throw new Error('IBookLogStore.updateReading not implemented'); }

  /**
   * Fix one row of evidence — a page typed wrong, a day chosen wrong.
   * @param {{learnerId: string, readingId: string, entryId: string, patch: object,
   *          revision?: object|null}} change
   * @returns {Promise<object>} the updated entry
   */
  async updateEntry() { throw new Error('IBookLogStore.updateEntry not implemented'); }

  /**
   * Remove one row of evidence. The child's record got smaller: callers owe
   * them a reason.
   * @param {{learnerId: string, readingId: string, entryId: string, revision?: object|null}} change
   * @returns {Promise<object>} the removed entry
   */
  async deleteEntry() { throw new Error('IBookLogStore.deleteEntry not implemented'); }

  /**
   * Remove a whole reading.
   * @param {{learnerId: string, readingId: string}} change
   * @returns {Promise<object>} the removed reading
   */
  async deleteReading() { throw new Error('IBookLogStore.deleteReading not implemented'); }

  /**
   * Move a reading to another learner's shelf.
   *
   * An implementation MUST write the destination before removing from the
   * source, so a damaged destination refuses the move instead of losing the
   * record between two shelves.
   *
   * @param {{learnerId: string, readingId: string, toLearnerId: string,
   *          revision?: object|null}} move
   * @returns {Promise<object>} the moved reading
   */
  async moveReading() { throw new Error('IBookLogStore.moveReading not implemented'); }

  /**
   * Every reading for one learner, each carrying its entries.
   * @param {string} learnerId
   * @returns {Promise<object[]>}
   */
  async listForLearner() { throw new Error('IBookLogStore.listForLearner not implemented'); }

  /**
   * Books scanned with nobody logged in, awaiting a claim (S15).
   * @param {{location?: string|null}} [filter]
   * @returns {Promise<object[]>}
   */
  async listUnclaimed() { return []; }
}

export default IBookLogStore;
