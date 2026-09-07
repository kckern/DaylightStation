/**
 * UpdateReading — the identity and state bands of the reading detail: the
 * ISBN, the progress mode, the page count, the status and the finish day.
 *
 * All of it is silent except one transition. Un-finishing takes a book back
 * off the finished pile — the child's record got SMALLER — so that one alone
 * requires a reason and delivers it. Correcting a mis-scanned ISBN or a wrong
 * page count says nothing, because there is nothing a child needs to know.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { isDayKey, PROGRESS_MODES } from '#domains/school/bookShelf.mjs';
import {
  ReadingEditContext, applyReadingOperation, assertFreshRevisions,
  OPS, TEACHER_STATUSES, isBlank,
} from './readingEdits.mjs';

/** The flat, teacher-facing fields. Evidence is not one of them. */
const EDITABLE = new Set(['isbn', 'pageCount', 'progressMode', 'status', 'finishedOn']);

export class UpdateReading {
  #context;

  constructor(deps = {}) { this.#context = new ReadingEditContext(deps); }

  async execute({ learnerId, readingId, patch = {}, reason = null, by = null, pin = null, baseRevisionCount } = {}) {
    this.#context.assert({ op: OPS.READING_UPDATE, userId: by, pin, learnerId, readingId });
    const flat = normalize(patch);
    const reading = await this.#context.reading(learnerId, readingId);
    assertFreshRevisions(reading, baseRevisionCount);
    validate(flat, reading);

    return applyReadingOperation(this.#context, {
      learnerId, reading, op: OPS.READING_UPDATE, patch: flat, by, pin, reason,
    });
  }
}

function normalize(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('patch must be an object');
  }
  const flat = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!EDITABLE.has(field)) throw new ValidationError(`a reading's ${field} cannot be edited here`);
    flat[field] = value;
  }
  if (!Object.keys(flat).length) throw new ValidationError('patch is empty');
  return flat;
}

function validate(flat, reading) {
  if (flat.isbn !== undefined && isBlank(flat.isbn)) throw new ValidationError('isbn cannot be blank');
  if (flat.pageCount !== undefined && flat.pageCount !== null
      && !(Number.isInteger(flat.pageCount) && flat.pageCount > 0)) {
    throw new ValidationError('pageCount must be a positive whole number, or null');
  }
  if (flat.progressMode !== undefined && !PROGRESS_MODES.includes(flat.progressMode)) {
    throw new ValidationError(`unknown progress mode: ${flat.progressMode}`);
  }
  if (flat.status !== undefined && !TEACHER_STATUSES.includes(flat.status)) {
    throw new ValidationError(`unknown status: ${flat.status}`);
  }
  if (flat.finishedOn !== undefined && flat.finishedOn !== null && !isDayKey(flat.finishedOn)) {
    throw new ValidationError(`finishedOn must be a real day: ${flat.finishedOn}`);
  }
  const status = flat.status ?? reading.status;
  if (status === 'finished') {
    const finishedOn = flat.finishedOn ?? reading.finishedOn;
    if (!isDayKey(finishedOn)) throw new ValidationError('a finished book needs the day it was finished');
    flat.finishedOn = finishedOn;
  } else if (flat.status !== undefined && reading.finishedOn) {
    // A book that is no longer finished has no finish day. Left behind, it
    // would keep counting against a `books` obligation that nothing shows.
    flat.finishedOn = null;
  }
}

export default UpdateReading;
