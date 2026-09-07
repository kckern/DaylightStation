/**
 * AddReadingForLearner — open a book on a child's behalf.
 *
 * The one verb with no `baseRevisionCount`: nothing was loaded, because the
 * reading does not exist yet. Idempotent on the caller's key, exactly as the
 * child's own open is — a retried POST must not put the same book on the shelf
 * twice, and a duplicate finish is a duplicate BOOK against an obligation.
 *
 * Silent. A book appearing on the shelf is the record getting bigger.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { isDayKey, PROGRESS_MODES } from '#domains/school/bookShelf.mjs';
import { ReadingEditContext, OPS, isBlank } from './readingEdits.mjs';

export class AddReadingForLearner {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({
    learnerId, isbn, progressMode = 'page', pageCount = null, openedOn = null,
    reason = null, by = null, pin = null, idempotencyKey = null,
  } = {}) {
    this.#context.assert({ op: OPS.READING_ADD, userId: by, pin, learnerId });
    if (isBlank(learnerId)) throw new ValidationError('learnerId is required');
    if (isBlank(isbn)) throw new ValidationError('isbn is required');
    if (!PROGRESS_MODES.includes(progressMode)) throw new ValidationError(`unknown progress mode: ${progressMode}`);
    if (pageCount !== null && !(Number.isInteger(pageCount) && pageCount > 0)) {
      throw new ValidationError('pageCount must be a positive whole number, or null');
    }
    if (openedOn !== null && !isDayKey(openedOn)) throw new ValidationError(`openedOn must be a real day: ${openedOn}`);

    const opened = await this.#context.bookLog.openReading({
      learnerId, isbn, progressMode, pageCount, openedOn,
      idempotencyKey: idempotencyKey ?? `teacher-${this.#context.now()}`,
    });

    // The store answered with the reading this key already opened. Recording a
    // second opening would put a fact in the history that did not happen.
    const already = (opened.revisions ?? []).find((revision) => revision?.op === OPS.READING_ADD);
    if (already) return { reading: opened, revision: already, created: false };

    const revision = this.#context.revision({
      verb: OPS.READING_ADD, op: OPS.READING_ADD, by,
      before: null,
      after: { id: opened.id, isbn, progressMode, pageCount, openedOn: opened.openedOn },
      reason, toldChild: false,
    });
    // `openReading` mints the record; the revision saying a grown-up opened it
    // rides a no-op patch, the same way an appended entry's does.
    const reading = await this.#context.bookLog.updateReading({
      learnerId, readingId: opened.id, patch: { status: opened.status }, revision,
    });
    this.#context.logger.info?.('school.teacher-reading.opened', { learnerId, readingId: opened.id, isbn, by });
    return { reading, revision, created: true };
  }
}

export default AddReadingForLearner;
