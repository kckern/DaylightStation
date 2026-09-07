/**
 * AddReadingEntry — the day a child read that never got logged.
 *
 * Silent, and stamped `source: 'teacher'` so the row says who put it there.
 * Adding evidence only ever makes the record bigger, and a note about it would
 * be noise in the one feed that has to carry the sentences that matter.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { isDayKey } from '#domains/school/bookShelf.mjs';
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS } from './readingEdits.mjs';

export class AddReadingEntry {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({
    learnerId, readingId, on, page = null, minutes = null, note = null,
    reason = null, by = null, pin = null, idempotencyKey = null, baseRevisionCount,
  } = {}) {
    this.#context.assert({ op: OPS.ENTRY_ADD, userId: by, pin, learnerId, readingId });
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    if (!isDayKey(on)) throw new ValidationError(`on must be a real day: ${on}`);
    if (page !== null && !(Number.isInteger(page) && page > 0)) {
      throw new ValidationError('page must be a positive whole number');
    }
    if (minutes !== null && !(Number.isFinite(minutes) && minutes > 0)) {
      throw new ValidationError('minutes must be a positive number');
    }
    // A check-in carries neither, and that is the whole point of `check` mode;
    // in the other two modes a row with no page and no minutes is evidence of
    // nothing and would still count as a day read.
    if (page === null && minutes === null && reading.progressMode !== 'check') {
      throw new ValidationError('an entry needs a page or minutes unless the book is logged by check-in');
    }

    return applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.ENTRY_ADD, by, pin, reason,
      entry: {
        on, page, minutes, source: 'teacher', at: this.#context.now(),
        ...(note ? { note } : {}),
        idempotencyKey,
      },
    });
  }
}

export default AddReadingEntry;
