// The same rule the teacher path uses to find "the reading a grown-up means"
// (`teacher/GetBookReaders.mjs`). A set-aside book is not open: filing it
// starts a new reading, exactly as adding it from the console does.
const OPEN_STATUSES = new Set(['reading', 'unread']);

/**
 * FileBookPile — one scanned book from the Portal pile joins a learner's shelf
 * as finished on today's study day.
 *
 * NOTHING IS LOGGED TWICE, and it is decided here by LOOKING at the shelf, not
 * by trusting idempotency keys alone. The store dedupes on an entry's key but a
 * second open of the same book is, to it, a second reading (a reread). So:
 *   - an open reading of the book is FINISHED, never shadowed by a new copy;
 *   - a reading already finished today means the write is skipped;
 *   - only otherwise is a new finished reading opened.
 * The keys still matter: `attemptKey` is the caller's (card, attempt) id, so a
 * retried request reuses its keys and lands once, while a re-file after Undo
 * carries a new attempt and really finishes again.
 *
 * It writes through the shelf's own use cases (`source: 'panel'`), so a pile
 * filing is the child's own entry with the same credit as their shelf's.
 */
export class FileBookPile {
  #bookLog; #open; #record; #dayOf; #clock; #logger;
  constructor({ bookLog, openBookShelfItem, recordBookProgress, dayOf, clock = () => new Date(), logger = {} } = {}) {
    if (!bookLog || !openBookShelfItem || !recordBookProgress) throw new Error('FileBookPile requires bookLog, openBookShelfItem and recordBookProgress');
    if (typeof dayOf !== 'function') throw new Error('FileBookPile requires dayOf');
    this.#bookLog = bookLog; this.#open = openBookShelfItem; this.#record = recordBookProgress;
    this.#dayOf = dayOf; this.#clock = clock; this.#logger = logger;
  }

  async file({ learnerId, isbn13, attemptKey }) {
    const today = this.#dayOf(this.#clock().toISOString());
    const ofBook = (await this.#bookLog.listForLearner(learnerId)).filter((reading) => reading?.book?.isbn === isbn13);
    const open = ofBook
      .filter((reading) => OPEN_STATUSES.has(reading.status))
      .sort((a, b) => String(b.openedOn ?? '').localeCompare(String(a.openedOn ?? '')))[0];
    let result;
    if (open) {
      await this.#record.execute({ learnerId, itemId: open.id, kind: 'finished', entryId: `pile:${attemptKey}:finish` });
      result = { outcome: 'finished-open', itemId: open.id };
    } else {
      const done = ofBook.find((reading) => reading.status === 'finished' && reading.finishedOn === today);
      if (done) {
        result = { outcome: 'already-today', itemId: done.id };
      } else {
        const { item } = await this.#open.execute({
          learnerId, bookId: isbn13, where: 'finished', finishedOn: today,
          entryId: `pile:${attemptKey}:open`, progressEntryId: `pile:${attemptKey}:finish`,
        });
        result = { outcome: 'finished-new', itemId: item.itemId };
      }
    }
    this.#logger.debug?.('school.book-pile.filed-one', { learnerId, outcome: result.outcome });
    return result;
  }

  /**
   * Take back what `file` did, and only that.
   *   - `already-today`: the pile wrote nothing, so it undoes nothing. That
   *     finish is the child's own; reopening it would delete their credit.
   *   - `finished-new`: the pile created the reading, so it removes it — a
   *     reopen would leave a book the child never touched "currently reading".
   *     Only while every entry on it is the pile's own; once the child has
   *     added to it, it is theirs and is reopened instead.
   *   - `finished-open`: the shelf's Undo finish (append-only reopen that
   *     withdraws the finish credit).
   */
  async undo({ learnerId, itemId, attemptKey, outcome }) {
    if (outcome === 'already-today') return { outcome: 'untouched' };
    if (outcome === 'finished-new') {
      const reading = (await this.#bookLog.listForLearner(learnerId)).find((entry) => entry.id === itemId);
      const pileOnly = reading && (reading.entries ?? []).every((entry) => String(entry?.idempotencyKey ?? '').startsWith('pile:'))
        && String(reading.idempotencyKey ?? 'pile:').startsWith('pile:');
      if (pileOnly) {
        await this.#bookLog.deleteReading({ learnerId, readingId: itemId });
        return { outcome: 'removed' };
      }
    }
    await this.#record.execute({ learnerId, itemId, kind: 'reopened', entryId: `pile:${attemptKey}:undo` });
    return { outcome: 'reopened' };
  }
}
