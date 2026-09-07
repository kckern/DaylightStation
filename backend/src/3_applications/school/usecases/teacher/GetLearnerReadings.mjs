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
 * derive it is a second way to be wrong about it.
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

    if (readingId) {
      const reading = await this.#context.reading(learnerId, readingId);
      return { learnerId, reading: await this.#view(reading) };
    }
    const readings = await this.#context.bookLog.listForLearner(learnerId) ?? [];
    return { learnerId, readings: await Promise.all(readings.map((reading) => this.#view(reading))) };
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
