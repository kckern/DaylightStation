/**
 * UpdateReadingEntry — a page typed wrong, minutes guessed wrong, or a day
 * chosen wrong.
 *
 * Silent, with one exception that is the reason this verb needs the
 * obligation at all: re-dating a day OUT of the counted window takes it off
 * the child's total for the week. The record got smaller, so the child hears
 * why. Re-dating within the window changes nothing they are measured on.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { isDayKey } from '#domains/school/bookShelf.mjs';
import { ReadingEditContext, applyReadingOperation, assertFreshRevisions, OPS } from './readingEdits.mjs';

const EDITABLE = new Set(['on', 'page', 'minutes', 'note']);

export class UpdateReadingEntry {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({
    learnerId, readingId, entryId, patch = {}, reason = null,
    by = null, pin = null, baseRevisionCount,
  } = {}) {
    this.#context.assert({ op: OPS.ENTRY_UPDATE, userId: by, pin, learnerId, readingId });
    const clean = normalize(patch);
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);

    // Only asked for when the day moves: the obligation read is a read of the
    // child's assignments and shelf, and a page correction has no business
    // paying for it.
    const window = clean.on !== undefined ? await this.#context.countedWindow(learnerId) : null;

    return applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.ENTRY_UPDATE, entryId, patch: clean, by, pin, reason, window,
    });
  }
}

function normalize(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object');
  }
  const clean = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!EDITABLE.has(field)) throw new ValidationError(`an entry's ${field} cannot be edited`);
    clean[field] = value;
  }
  if (!Object.keys(clean).length) throw new ValidationError('patch is empty');
  if (clean.on !== undefined && !isDayKey(clean.on)) throw new ValidationError(`on must be a real day: ${clean.on}`);
  if (clean.page !== undefined && clean.page !== null && !(Number.isInteger(clean.page) && clean.page > 0)) {
    throw new ValidationError('page must be a positive whole number');
  }
  if (clean.minutes !== undefined && clean.minutes !== null
      && !(Number.isFinite(clean.minutes) && clean.minutes > 0)) {
    throw new ValidationError('minutes must be a positive number');
  }
  return clean;
}

export default UpdateReadingEntry;
