/**
 * GetBookReaders — one book, every enrolled learner, and where each of them
 * is with it (quick-log design, 2026-10-20).
 *
 * The read behind the teacher console's "Log a book" sheet. The console
 * decides nothing the server already decides (reading-log.md §5), so this is
 * where three questions are answered for each child:
 *
 * - `today` — did this child already log this book on the household's study
 *   day (opened, finished, or a day of evidence)? The sheet warns and does
 *   not preselect; it never blocks, because twice on purpose is allowed.
 * - `openReading` — is there an open reading of this ISBN? Then today's
 *   check-in or finish goes ON it, and the row carries what a write to it
 *   needs: its mode, its length and `revisionCount` (the `baseRevisionCount`
 *   every edit verb requires).
 * - `finishedTodayIds` — the readings of this ISBN finished on the study day,
 *   so a retried save can tell its own finish landed.
 * - `suggestedMode` — `defaultProgressMode`, from the book's length.
 *
 * A finished reading carries no flag: a re-read is a new reading.
 *
 * One book-facts lookup, then one shelf read per learner. An unreadable shelf
 * is named on its own row rather than failing the whole read, so one damaged
 * file does not stop a grown-up logging the book for the other children.
 *
 * Strictly a read: it opens nothing and appends nothing.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { defaultProgressMode } from "../../../domain/bookShelf.mjs";
import { ReadingEditContext } from "./readingEdits.mjs";

const ISBN13 = /^\d{13}$/;
/** `unread` is a reading opened and never logged against: still open. */
const OPEN_STATUSES = new Set(['reading', 'unread']);

export class GetBookReaders {
  #context;
  #roster;

  constructor({ roster, ...deps } = {}) {
    if (typeof roster !== 'function') throw new Error('GetBookReaders requires a roster accessor');
    this.#context = new ReadingEditContext(deps);
    this.#roster = roster;
  }

  async execute({ isbn, by = null, pin = null } = {}) {
    // The gate FIRST: a refusal must not reveal who has which book.
    this.#context.assert({
      action: 'books.readers.read', userId: by, pin, learnerId: null, extra: { isbn: isbn ?? null },
    });
    if (typeof isbn !== 'string' || !ISBN13.test(isbn)) {
      throw new ValidationError(`isbn must be a 13-digit ISBN: ${isbn}`);
    }

    const studyDay = this.#context.studyDay() ?? this.#context.now().slice(0, 10);
    const facts = await this.#context.facts(isbn);
    const pageCount = Number.isInteger(facts?.pageCount) && facts.pageCount > 0 ? facts.pageCount : null;
    const suggestedMode = defaultProgressMode(pageCount);

    const learners = (await this.#roster()) ?? [];
    const readers = [];
    // Sequential on purpose: a household roster is a handful of children.
    for (const learner of learners) {
      const learnerId = learner?.id ?? learner?.learnerId ?? null;
      if (!learnerId) continue;
      readers.push(await this.#reader({ learnerId, name: learner?.name ?? learnerId }, isbn, studyDay, suggestedMode));
    }
    return { isbn, studyDay, pageCount, suggestedMode, readers };
  }

  async #reader({ learnerId, name }, isbn, studyDay, suggestedMode) {
    const row = { learnerId, name, suggestedMode };
    let readings;
    try {
      readings = (await this.#context.bookLog.listForLearner(learnerId)) ?? [];
    } catch (error) {
      this.#context.logger.warn?.('school.teacher-reading.readers-shelf-unreadable', { learnerId, isbn, error: error.message });
      return { ...row, today: false, openReadingId: null, openReading: null, finishedTodayIds: [], unreadable: true };
    }

    const ofBook = readings.filter((reading) => reading?.book?.isbn === isbn);
    const today = ofBook.some((reading) => reading.openedOn === studyDay
      || reading.finishedOn === studyDay
      || (reading.entries ?? []).some((entry) => entry?.on === studyDay));
    // Two open readings of one book should not happen; if it has, the newest
    // is the one a grown-up means.
    const open = ofBook
      .filter((reading) => OPEN_STATUSES.has(reading.status))
      .sort((a, b) => String(b.openedOn ?? '').localeCompare(String(a.openedOn ?? '')))[0] ?? null;

    return {
      ...row,
      today,
      openReadingId: open?.id ?? null,
      openReading: open ? {
        id: open.id,
        progressMode: open.progressMode ?? 'page',
        pageCount: open.book?.pageCount ?? null,
        revisionCount: Array.isArray(open.revisions) ? open.revisions.length : 0,
      } : null,
      // Which readings of this book were finished on the study day. A save
      // whose finish response was lost re-reads this to see that it landed,
      // instead of opening a second, duplicate finished reading.
      finishedTodayIds: ofBook
        .filter((reading) => reading.status === 'finished' && reading.finishedOn === studyDay)
        .map((reading) => reading.id),
      unreadable: false,
    };
  }
}

export default GetBookReaders;
