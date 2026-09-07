/**
 * GetLearnerReadings — the grown-up's editing view of one child's shelf.
 *
 * The workspace's summary read is `GetBookShelf`, the SAME use case the
 * child's panel uses; this one answers the question the editor asks and that
 * one deliberately does not: what is the full history of this reading, and
 * what revision count must I send back when I save?
 *
 * `baseRevisionCount` is served here rather than counted on the client,
 * because it is the value every write is checked against and a second way to
 * derive it is a second way to be wrong about it. `countedWindow` is served
 * for the same reason: whether re-dating an entry takes it off the child's
 * total is the server's rule, and the console must not hold a second copy of
 * it — nor be unable to tell "no obligation" from "could not determine".
 *
 * Observation costs nothing (design §7 invariant 7): this opens nothing, mints
 * nothing, and writes nothing.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { projectReading } from '#domains/school/bookShelf.mjs';
import { ReadingEditContext, isBlank } from './readingEdits.mjs';

export class GetLearnerReadings {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId = null, by = null, pin = null } = {}) {
    this.#context.assert({ action: 'books.shelf.read', userId: by, pin, learnerId, readingId });
    if (isBlank(learnerId)) throw new ValidationError('learnerId is required');

    // Served, not derived downstream. Whether a re-date drops a day out of the
    // counted window is one rule, and a console that recomputed it from an
    // obligation and a study day would be a second implementation of it —
    // one that goes quiet, rather than wrong, the day the shelf read carries
    // no obligation.
    const countedWindow = await this.#context.countedWindowView(learnerId);

    if (readingId) {
      const reading = await this.#context.reading(learnerId, readingId);
      return { learnerId, countedWindow, reading: await this.#view(reading) };
    }
    const readings = await this.#context.bookLog.listForLearner(learnerId) ?? [];
    return {
      learnerId,
      countedWindow,
      readings: await Promise.all(readings.map((reading) => this.#view(reading))),
    };
  }

  async #view(reading) {
    const isbn = reading?.book?.isbn ?? null;
    const book = await this.#context.facts(isbn);
    return {
      ...reading,
      isbn,
      // Never invented (design §6): a cover that will not load gets the
      // panel's calm placeholder, not a guess.
      title: book?.title ?? null,
      subtitle: book?.subtitle ?? null,
      authors: book?.authors ?? [],
      coverUrl: book?.coverUrl ?? null,
      projection: projectReading(reading),
      baseRevisionCount: Array.isArray(reading?.revisions) ? reading.revisions.length : 0,
    };
  }
}

export default GetLearnerReadings;
