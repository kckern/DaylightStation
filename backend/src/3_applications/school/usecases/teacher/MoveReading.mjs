/**
 * MoveReading — the book landed on the wrong child's shelf.
 *
 * A **step-up** verb (`books.reading.reassign`, scoped to the reading id): it
 * changes whose reading year this book belongs to, which is the same class of
 * consequence as `sessions.reassign`. Reason required, and BOTH children are
 * told — one lost a book off their shelf, the other gained one, and neither
 * should discover it by noticing.
 *
 * The store writes the destination shelf before it touches the source, so a
 * damaged destination refuses the move rather than half-completing it
 * (teacher.md §10).
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS, isBlank } from './readingEdits.mjs';

export class MoveReading {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId, toLearnerId, reason = null, by = null, pin = null, baseRevisionCount } = {}) {
    this.#context.assert({
      op: OPS.READING_MOVE, userId: by, pin, learnerId, readingId, extra: { toLearnerId },
    });
    if (isBlank(toLearnerId)) throw new ValidationError('toLearnerId is required');
    if (toLearnerId === learnerId) {
      throw new ValidationError('a reading cannot move to the shelf it is already on');
    }
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    return applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.READING_MOVE, toLearnerId, by, pin, reason,
    });
  }
}

export default MoveReading;
