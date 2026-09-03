/**
 * IBookLogStore — durable evidence of what a learner actually read.
 *
 * Records, not runtime: a report card is reconstructed from this, so it lives
 * under `school/records/` and is never pruned by a cooldown or a session close.
 * Same rule `IReadingLogStore` holds, for the same reason.
 *
 * ## SHARDED BY LEARNER, NOT BY DAY
 *
 * `IReadingLogStore` shards by study day because a daily count is asked about
 * one day at a time. A book is the opposite shape: it spans days, and every
 * question worth asking ("what is on this child's shelf", "how far into it are
 * they", "what have they finished this month") is a question about a LEARNER
 * across time. Sharding by day would scatter one book's events across a dozen
 * files and make the shelf a fan-out read.
 *
 * ## APPEND-ONLY. STATE IS DERIVED.
 *
 * An implementation stores shelf items and their events, never a computed
 * status, page or percentage — `projectShelfItem` recomputes those on read.
 * Writing a status would create a second source of truth that can disagree
 * with the events it was derived from.
 *
 * ## IDEMPOTENT ON `entryId`
 *
 * The caller mints one id per recorded event and may send it more than once —
 * a retried POST, a remounted screen. A duplicate `finished` is a duplicate
 * BOOK against an obligation, so an implementation MUST return the existing
 * event unchanged rather than appending a second. This is exactly the hazard
 * `IReadingLogStore` documents for `pickId`.
 *
 * @module applications/school/ports/IBookLogStore
 */
export class IBookLogStore {
  /**
   * Open a book on a learner's shelf, or return the item already there.
   *
   * A second `started` for a book already `finished` opens a NEW item — two
   * reads of one book are two reads (S9) — so implementations key items by
   * the `started` event's `entryId`, so `itemId` never depends on `openedAt`;
   * `entryId` is therefore required.
   *
   * @param {{learnerId: string, bookId: string, progressMode: string,
   *          pageCount: number|null, openedAt: string, entryId: string}} item
   * @returns {Promise<object>} the stored shelf item
   */
  async openItem() { throw new Error('IBookLogStore.openItem not implemented'); }

  /**
   * Append one progress event to an existing shelf item.
   *
   * @param {{itemId: string, kind: 'progress'|'finished'|'set-aside',
   *          at: string, page?: number|null, minutes?: number|null,
   *          note?: string|null, rating?: number|null, source?: string|null,
   *          externalId?: string|null, entryId: string}} event
   * @returns {Promise<object>} the stored event — the existing one on a repeat
   */
  async appendEvent() { throw new Error('IBookLogStore.appendEvent not implemented'); }

  /**
   * Change how progress is expressed for one item. Never rewrites events —
   * a book logged by page and then switched to `check` keeps its pages (S6c).
   * @param {{itemId: string, progressMode: 'page'|'minutes'|'check'}} change
   * @returns {Promise<object>} the updated shelf item
   */
  async setProgressMode() { throw new Error('IBookLogStore.setProgressMode not implemented'); }

  /**
   * Every shelf item for one learner, each carrying its events.
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
