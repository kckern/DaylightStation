/**
 * AddReadingForLearner — open a book on a child's behalf.
 *
 * The one verb with no `baseRevisionCount`: nothing was loaded, because the
 * reading does not exist yet. Idempotent on the caller's key, exactly as the
 * child's own open is — a retried POST must not put the same book on the shelf
 * twice, and a duplicate finish is a duplicate BOOK against an obligation.
 *
 * **The child's three doors, in one call** (`OpenBookShelfItem`'s `where`):
 * `starting` needs nothing, `partway` needs the page they are on, `finished`
 * needs the day they finished. A grown-up adding a book is answering the same
 * question about the same child, so it is answered in the same vocabulary —
 * and in ONE call, because a book that landed on the shelf with its day
 * half-applied would be a record nobody asked for.
 *
 * The three differences from the child's own door, all deliberate:
 * - `source: 'teacher'` on the day, so the row says who put it there;
 * - no backdate floor — repairing a record from months ago is the whole point
 *   of this surface, and the floor exists to keep a CHILD honest at the panel;
 * - the length comes from the books API when the caller sends none, so the
 *   console can ask for an ISBN and a door and nothing else.
 *
 * Silent. A book appearing on the shelf is the record getting bigger.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { isDayKey, PROGRESS_MODES } from '#domains/school/bookShelf.mjs';
import { ReadingEditContext, OPS, isBlank } from './readingEdits.mjs';

/** Where the child is with it, in the words the child's own panel uses. */
const DOORS = ['starting', 'partway', 'finished'];

export class AddReadingForLearner {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({
    learnerId, isbn, progressMode = 'page', pageCount = null, openedOn = null,
    where = 'starting', page = null, finishedOn = null,
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
    if (!DOORS.includes(where)) throw new ValidationError(`where must be starting|partway|finished, got: ${where}`);
    if (page !== null && where !== 'partway') throw new ValidationError('a page only belongs to the partway door');
    if (finishedOn !== null && where !== 'finished') throw new ValidationError('a finish day only belongs to the finished door');
    if (where === 'partway') {
      if (!(Number.isInteger(page) && page > 0)) throw new ValidationError('the partway door needs the page they are on');
      // A page is evidence for page mode, and evidence of nothing in the other
      // two: a `minutes` reading counts minutes and a `check` one counts days.
      if (progressMode !== 'page') throw new ValidationError('a page belongs to a page-mode reading');
    }
    if (where === 'finished' && !isDayKey(finishedOn)) {
      throw new ValidationError(`the finished door needs the day they finished it: ${finishedOn}`);
    }

    // Never invented, and never asked of the grown-up: the length is a fact
    // about the book, so it comes from the books API when one is wired.
    const length = pageCount ?? await this.#length(isbn);

    const opened = await this.#context.bookLog.openReading({
      learnerId, isbn, progressMode, pageCount: length, openedOn,
      idempotencyKey: idempotencyKey ?? `teacher-${this.#context.now()}`,
    });

    // The store answered with the reading this key already opened. Recording a
    // second opening — or a second day — would put a fact in the history that
    // did not happen.
    const already = (opened.revisions ?? []).find((revision) => revision?.op === OPS.READING_ADD);
    if (already) return { reading: opened, revision: already, created: false };

    const at = this.#context.now();
    const today = this.#context.studyDay() ?? opened.openedOn ?? at.slice(0, 10);
    // THE EVIDENCE FIRST, THEN THE DECISION, exactly as the child's own
    // finished door does it. Interrupted between the two, the shelf
    // under-reports a finished book as still being read — which is fixable;
    // the other order claims a finish with nothing behind it.
    const entry = where === 'starting' ? null : await this.#context.bookLog.appendEntry({
      learnerId, readingId: opened.id, at, source: 'teacher',
      on: where === 'finished' ? finishedOn : today,
      page: where === 'partway' ? page : null,
      minutes: null,
      // Derived from the opening's key so a retry that got past `openReading`
      // cannot append the day a second time.
      idempotencyKey: `${idempotencyKey ?? opened.id}:opened`,
    });

    const revision = this.#context.revision({
      verb: OPS.READING_ADD, op: OPS.READING_ADD, by,
      before: null,
      after: {
        id: opened.id, isbn, progressMode, pageCount: length, openedOn: opened.openedOn,
        ...(entry ? { on: entry.on } : {}),
        ...(where === 'partway' ? { page } : {}),
        ...(where === 'finished' ? { status: 'finished', finishedOn } : {}),
      },
      reason, toldChild: false,
    });
    // `openReading` mints the record; the revision saying a grown-up opened it
    // rides the status patch, the same way an appended entry's does.
    const reading = await this.#context.bookLog.updateReading({
      learnerId,
      readingId: opened.id,
      patch: where === 'finished' ? { status: 'finished', finishedOn } : { status: opened.status },
      revision,
    });
    this.#context.logger.info?.('school.teacher-reading.opened', { learnerId, readingId: opened.id, isbn, where, by });
    return { reading, revision, created: true };
  }

  /** The book's length, or null. A books API that is down is not a length. */
  async #length(isbn) {
    const count = (await this.#context.facts(isbn))?.pageCount ?? null;
    return Number.isInteger(count) && count > 0 ? count : null;
  }
}

export default AddReadingForLearner;
