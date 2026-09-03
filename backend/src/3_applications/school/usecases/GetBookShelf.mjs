import { ValidationError } from '#domains/core/errors/index.mjs';
import { projectShelfItem } from '#domains/school/bookShelf.mjs';

/**
 * GetBookShelf — everything the shelf screen needs for one learner, in one read.
 *
 * Items come from the log, facts (title, authors, cover) from the resolved-record
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
  #clock;
  #logger;

  constructor({ bookLog, bookRepository, bookLogLauncher, clock = () => new Date(), logger = console } = {}) {
    for (const [name, dep] of Object.entries({ bookLog, bookRepository, bookLogLauncher })) {
      if (!dep) throw new Error(`GetBookShelf requires ${name}`);
    }
    this.#bookLog = bookLog;
    this.#bookRepository = bookRepository;
    this.#bookLogLauncher = bookLogLauncher;
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({ learnerId } = {}) {
    if (typeof learnerId !== 'string' || !learnerId) throw new ValidationError('learnerId is required');
    const dayOf = (iso) => this.#bookLogLauncher.dayOf(iso);
    const studyDay = dayOf(this.#clock().toISOString());
    const [items, status] = await Promise.all([
      this.#bookLog.listForLearner(learnerId),
      this.#bookLogLauncher.status({ userId: learnerId }),
    ]);
    const enriched = await Promise.all(items.map(async (item) => {
      let book = null;
      try {
        book = await this.#bookRepository.findByIsbn(item.bookId);
      } catch (error) {
        this.#logger.warn?.('school.book-shelf.book-facts-failed', { learnerId, bookId: item.bookId, error: error.message });
      }
      return {
        ...item,
        title: book?.title ?? null,
        authors: book?.authors ?? [],
        coverUrl: book?.coverUrl ?? null,
        projection: projectShelfItem(item, { dayOf }),
      };
    }));
    enriched.sort((a, b) => String(b.projection.lastAt ?? '').localeCompare(String(a.projection.lastAt ?? '')));
    const progress = status?.obligationProgress ?? null;
    return {
      learnerId,
      studyDay,
      items: enriched,
      obligation: progress ? { label: status.progressLabel ?? null, ...progress } : null,
    };
  }
}

export default GetBookShelf;
