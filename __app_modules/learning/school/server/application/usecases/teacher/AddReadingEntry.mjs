/**
 * AddReadingEntry — the day a child read that never got logged.
 *
 * Silent, and stamped `source: 'teacher'` so the row says who put it there.
 * Adding evidence only ever makes the record bigger, and a note about it would
 * be noise in the one feed that has to carry the sentences that matter.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { StateConflictError } from '#apps/common/errors/SemanticErrors.mjs';
import { isDayKey } from "../../../domain/bookShelf.mjs";
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS } from "./readingEdits.mjs";

export class AddReadingEntry {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({
    learnerId, readingId, on, page = null, minutes = null, note = null,
    reason = null, by = null, pin = null, idempotencyKey = null, baseRevisionCount,
  } = {}) {
    this.#context.assert({ op: OPS.ENTRY_ADD, userId: by, pin, learnerId, readingId });
    const reading = await this.#context.reading(learnerId, readingId);
    const revisionCount = Array.isArray(reading?.revisions) ? reading.revisions.length : 0;

    // A replay BEFORE the freshness check: a retry whose first response was
    // lost carries the count it loaded before that first write landed, so it
    // is stale by exactly the write it is repeating. The entry is already
    // there; hand it back and append nothing (no second revision).
    const replayOf = idempotencyKey
      ? (reading?.entries ?? []).find((row) => row?.idempotencyKey === idempotencyKey) ?? null
      : null;
    if (replayOf) {
      assertSameEntry(replayOf, { on, page, minutes });
      this.#context.logger.info?.('school.teacher-reading.entry-replayed', { learnerId, readingId });
      return { revision: null, result: replayOf, revisionCount: countAfter(reading, replayOf, revisionCount), replayed: true };
    }

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

    const applied = await applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.ENTRY_ADD, by, pin, reason,
      entry: {
        on, page, minutes, source: 'teacher', at: this.#context.now(),
        ...(note ? { note } : {}),
        idempotencyKey,
      },
    });
    // The count the NEXT write on this reading must carry, read back from the
    // reading rather than assumed. Served so the caller never assumes it.
    const written = await this.#context.reading(learnerId, readingId);
    return {
      ...applied,
      revisionCount: Array.isArray(written?.revisions) ? written.revisions.length : revisionCount + 1,
      replayed: false,
    };
  }
}

/**
 * The count as it stood right after the ORIGINAL write: a replay must not
 * hand back a count that silently absorbs someone else's later edit, or the
 * caller's next write would land on a reading it never saw.
 */
function countAfter(reading, entry, fallback) {
  const revisions = Array.isArray(reading?.revisions) ? reading.revisions : [];
  const index = revisions.findIndex((row) => row?.verb === OPS.ENTRY_ADD && row?.after?.id === entry.id);
  return index === -1 ? fallback : index + 1;
}

/**
 * A key names ONE save. A repeat that says something else is a different
 * save on a reused key — refused, as the store refuses a key that already
 * opened a different book.
 */
function assertSameEntry(stored, { on, page, minutes }) {
  const differs = [];
  if (stored.on !== on) differs.push(`on ${stored.on}`);
  if ((stored.page ?? null) !== page) differs.push(stored.page == null ? 'no page' : `page ${stored.page}`);
  if ((stored.minutes ?? null) !== minutes) differs.push(stored.minutes == null ? 'no minutes' : `${stored.minutes} minutes`);
  if (differs.length) {
    throw new StateConflictError(
      `That save already landed with ${differs.join(', ')} — reload and try again.`,
      { code: 'IDEMPOTENCY_KEY_REUSED' },
    );
  }
}

export default AddReadingEntry;
