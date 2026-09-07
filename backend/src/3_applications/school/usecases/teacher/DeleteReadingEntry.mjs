/**
 * DeleteReadingEntry — remove one day of evidence.
 *
 * Always a shrink, so always a reason, and always a sentence the child reads.
 * The whole row is kept in the revision's `before`, which is the only reason
 * the deletion can be undone at all.
 */
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS } from './readingEdits.mjs';

export class DeleteReadingEntry {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId, entryId, reason = null, by = null, pin = null, baseRevisionCount } = {}) {
    this.#context.assert({ op: OPS.ENTRY_DELETE, userId: by, pin, learnerId, readingId });
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    return applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.ENTRY_DELETE, entryId, by, pin, reason,
    });
  }
}

export default DeleteReadingEntry;
