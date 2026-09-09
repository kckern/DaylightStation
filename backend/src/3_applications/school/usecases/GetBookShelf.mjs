import { ValidationError } from '#domains/core/errors/index.mjs';
import { projectReading, shelfItemView, earliestBackdateDay } from '#domains/school/bookShelf.mjs';

/**
 * GetBookShelf — everything the shelf screen needs for one learner, in one read.
 *
 * Items come from the log, facts (title, subtitle, authors, cover) from the resolved-record
 * repository, projections from the domain, and the obligation line from the
 * launcher. Days are counted with the LAUNCHER's `dayOf` so the agenda and the
 * card never disagree about `daysRead` for the same child (Task 5).
 *
 * A missing book record is not a missing shelf item: a child's log entry is
 * evidence regardless of whether the cover cache has the book, so facts default
 * to null rather than dropping the item.
 *
 * The view also names `studyDay` — `dayOf(now)` — so the panel's "Today"
 * is the household study day and not the browser's date: between midnight
 * and 4am local the two differ, and a "Today" finish on the browser's date
 * would land on tomorrow's study day and miss tonight's `checkins/day`
 * obligation (review m2).
 */
export class GetBookShelf {
  #bookLog;
  #bookRepository;
  #bookLogLauncher;
  #coverUrlFor;
  #clock;
  #logger;

  /**
   * `coverUrlFor` turns an ISBN into the address the panel renders art from.
   * Injected rather than built here because an API path is the API layer's to
   * name; the default keeps the record's own provider URL, which is what a
   * composition without the cover resolver should still show.
   */
  constructor({ bookLog, bookRepository, bookLogLauncher, coverUrlFor = null, clock = () => new Date(), logger = console } = {}) {
    for (const [name, dep] of Object.entries({ bookLog, bookRepository, bookLogLauncher })) {
      if (!dep) throw new Error(`GetBookShelf requires ${name}`);
    }
    this.#bookLog = bookLog;
    this.#bookRepository = bookRepository;
    this.#bookLogLauncher = bookLogLauncher;
    this.#coverUrlFor = typeof coverUrlFor === 'function' ? coverUrlFor : null;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    const studyDay = this.#bookLogLauncher.dayOf(this.#clock().toISOString());
    const [readings, status] = await Promise.all([
      this.#bookLog.listForLearner(learnerId),
      this.#bookLogLauncher.status({ userId: learnerId }),
    ]);
    const enriched = await Promise.all(readings.map(async (reading) => {
      // The panel's four fields, from wherever the record keeps them. `itemId`
      // is the reading id: opaque to the client, which never parses it.
      const view = shelfItemView(reading);
      let book = null;
      try {
        book = await this.#bookRepository.findByIsbn(view.bookId);
      } catch (error) {
        this.#logger.warn?.('school.book-shelf.book-facts-failed', { learnerId, bookId: view.bookId, error: error.message });
      }
      return {
        ...reading,
        ...view,
        title: book?.title ?? null,
        subtitle: book?.subtitle ?? null,
        authors: book?.authors ?? [],
        // Our address when the household serves covers itself, so a book
        // whose art was found on the fourth rung of the ladder renders exactly
        // like one whose publisher had it all along. A shelf item with no book
        // record still gets it: the art ladder needs only the ISBN.
        coverUrl: this.#coverUrlFor?.(view.bookId) ?? book?.coverUrl ?? null,
        projection: projectReading(reading),
      };
    }));
    enriched.sort((a, b) => String(b.projection.lastAt ?? '').localeCompare(String(a.projection.lastAt ?? '')));
    const progress = status?.obligationProgress ?? null;
    return {
      learnerId,
      studyDay,
      // The oldest day a finish may be dated, so the day picker cannot OFFER a
      // day the write path will refuse. Sent rather than recomputed on the
      // client for the same reason `studyDay` is: the household's rule is the
      // server's to state, and a second copy of "14" in the panel would drift
      // the first time the bound moved.
      earliestFinishDay: earliestBackdateDay(studyDay),
      items: enriched,
      obligation: progress ? { label: status.progressLabel ?? null, ...progress } : null,
    };
  }
}

export default GetBookShelf;
