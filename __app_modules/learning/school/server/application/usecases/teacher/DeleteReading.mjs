/**
 * DeleteReading — destroy the reading and everything logged against it.
 *
 * A gated verb (`books.reading.delete`, scoped to the reading id), a reason,
 * and a sentence to the child. The most consequential thing this
 * surface can do, and the only one it cannot take back: the revisions list is
 * kept ON the reading, so deleting the reading deletes the history that would
 * have been the route home. The revision comes back to the caller and is
 * logged, which is the whole trail there can be.
 */
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS } from "./readingEdits.mjs";

export class DeleteReading {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId, reason = null, by = null, baseRevisionCount } = {}) {
    this.#context.assert({ op: OPS.READING_DELETE, userId: by, learnerId, readingId });
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    const { revision, result } = await applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.READING_DELETE, by, reason,
    });
    this.#context.logger.info?.('school.teacher-reading.deleted', {
      learnerId, readingId, by, reason: revision.reason, toldChild: revision.toldChild,
      entries: (reading.entries ?? []).length,
    });
    return { revision, removed: result };
  }
}

export default DeleteReading;
