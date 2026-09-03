/**
 * The book shelf as a School program — a log first, and an obligation only if
 * a grown-up asks for one.
 *
 * ## THE OBLIGATION IS A SEPARATE LAYER OVER AN OBLIGATION-BLIND LOG
 *
 * `obligation: null` is the DEFAULT and a complete, valid enrollment. A child
 * enrolled that way gets the whole shelf — look a book up, log pages, finish
 * it, reflect on it — with nothing overdue and nothing red. Adding, changing or
 * removing an obligation later never migrates a single log entry, because no
 * log entry ever referred to one.
 *
 * ## ONE SMALL GRAMMAR, FIVE REAL ASKS
 *
 * Four metrics x a quantity x a window x an optional scope covers everything a
 * grown-up actually said they wanted, with nothing left over:
 *
 *   20 pages a day       {metric: pages,    quantity: 20, per: day}
 *   2 books a week       {metric: books,    quantity: 2,  per: week}
 *   check in daily       {metric: checkins, quantity: 1,  per: day}
 *   read THIS book       {metric: books,    quantity: 1,  per: once, scope: {books: [id]}}
 *   read THIS series     {metric: books,    quantity: 7,  per: once, scope: {books: [...]}}
 *
 * ## WHICH DAYS COUNT IS NOT THIS MODULE'S BUSINESS
 *
 * Every enrollment already passes through `validateSchedule` (`schoolCalendar`),
 * which owns `daysOfWeek`, `except` and `also`. "20 pages a day, weekdays only"
 * is this obligation PLUS that schedule. Duplicating the idea here would give a
 * household two places to excuse a Saturday, and one of them would lose.
 *
 * ## THE GRAMMAR IS CLOSED, AND UNKNOWN KEYS ARE ERRORS
 *
 * A key this file does not read is not a harmless extra — `pagez: 20` would be
 * dropped, leaving an obligation that demands nothing while its author believes
 * it is in force. Same call `validateSchedule` makes, for the same reason.
 *
 * @module domains/school/bookLog
 */
import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';

export const BOOK_LOG_PROGRAM_ID = 'book-log';

/** The subject a shelf sits under when the enrollment names none. */
export const DEFAULT_BOOK_LOG_SUBJECT = 'english';

/** How an obligation is counted. See `A3` in the PRD for each one's derivation. */
export const OBLIGATION_METRICS = Object.freeze(['pages', 'minutes', 'books', 'checkins']);

/** `once` means cumulative since enrollment — the only window that can be terminal. */
export const OBLIGATION_WINDOWS = Object.freeze(['day', 'week', 'month', 'once']);

/** Metrics that count progress WITHIN books rather than counting books. */
const RATE_METRICS = Object.freeze(['pages', 'minutes']);

/**
 * Ceilings, on purpose. An unmeetable obligation is a config typo that leaves a
 * child permanently red on the board with no error anywhere — refusing it at
 * write time is far cheaper than diagnosing a stuck tile weeks later. Same
 * reasoning as `MAX_STORY_TARGET`.
 */
const MAX_QUANTITY = Object.freeze({ pages: 2000, minutes: 1440, books: 500, checkins: 50 });

const OBLIGATION_KEYS = Object.freeze(['metric', 'quantity', 'per', 'scope']);
const SCOPE_KEYS = Object.freeze(['books', 'label']);

const isMapping = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Validate a book-log enrollment.
 *
 * @param {unknown} raw
 * @returns {{errors: string[], enrollment?: object}} the `{errors, enrollment}`
 *   shape every other program validator returns.
 */
export function validateBookLogEnrollment(raw) {
  const errors = [];
  if (!isMapping(raw)) return { errors: ['book-log enrollment must be a mapping'] };

  if (raw.programId !== BOOK_LOG_PROGRAM_ID) {
    errors.push(`programId must be ${BOOK_LOG_PROGRAM_ID}, got: ${raw.programId}`);
  }

  const subject = raw.subject ?? DEFAULT_BOOK_LOG_SUBJECT;
  if (!SUBJECT_IDS.includes(subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  }

  const title = raw.title === undefined || raw.title === null ? null : String(raw.title);

  const obligation = raw.obligation === undefined || raw.obligation === null
    ? { errors: [], value: null }
    : readObligation(raw.obligation);
  errors.push(...obligation.errors);

  if (errors.length) return { errors };
  return {
    errors: [],
    enrollment: {
      programId: BOOK_LOG_PROGRAM_ID,
      // `corpusId: null` makes SetAssignments' dedupe key refuse a second
      // book-log enrollment for the same learner: one shelf, not two.
      corpusId: null,
      subject,
      title,
      obligation: obligation.value,
    },
  };
}

function readObligation(raw) {
  const errors = [];
  if (!isMapping(raw)) return { errors: ['obligation must be a mapping'], value: null };

  const unknown = Object.keys(raw).filter((key) => !OBLIGATION_KEYS.includes(key));
  if (unknown.length) errors.push(`obligation has unknown keys: ${unknown.join(', ')}`);

  const { metric } = raw;
  if (!OBLIGATION_METRICS.includes(metric)) {
    errors.push(`obligation.metric must be one of ${OBLIGATION_METRICS.join('|')}, got: ${metric}`);
  }

  const per = raw.per;
  if (!OBLIGATION_WINDOWS.includes(per)) {
    errors.push(`obligation.per must be one of ${OBLIGATION_WINDOWS.join('|')}, got: ${per}`);
  }

  // `checkins` is inherently one-per-window; letting it carry a number would
  // invite `quantity: 3` meaning three check-ins a day, which nothing counts.
  const quantity = raw.quantity ?? (metric === 'checkins' ? 1 : undefined);
  if (!Number.isInteger(quantity) || quantity < 1) {
    errors.push(`obligation.quantity must be a positive integer, got: ${raw.quantity}`);
  } else if (OBLIGATION_METRICS.includes(metric) && quantity > MAX_QUANTITY[metric]) {
    errors.push(`obligation.quantity for ${metric} must be at most ${MAX_QUANTITY[metric]}, got: ${quantity}`);
  }

  const scope = readScope(raw.scope, errors);

  if (scope && RATE_METRICS.includes(metric)) {
    // "20 pages a day, but only out of these three" is not something anyone
    // means, and it becomes unmeetable the moment those books are finished.
    errors.push(`obligation.scope cannot be combined with the ${metric} metric — scope a books or checkins target instead`);
  }

  if (scope && Number.isInteger(quantity) && quantity > scope.books.length) {
    errors.push(`obligation.quantity (${quantity}) exceeds the ${scope.books.length} book(s) in scope`);
  }

  if (errors.length) return { errors, value: null };
  return { errors: [], value: { metric, quantity, per, scope } };
}

function readScope(raw, errors) {
  if (raw === undefined || raw === null) return null;
  if (!isMapping(raw)) { errors.push('obligation.scope must be a mapping'); return null; }

  const unknown = Object.keys(raw).filter((key) => !SCOPE_KEYS.includes(key));
  if (unknown.length) errors.push(`obligation.scope has unknown keys: ${unknown.join(', ')}`);

  if (!Array.isArray(raw.books)) {
    errors.push('obligation.scope.books must be a list of book ids');
    return null;
  }
  const books = raw.books.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
  if (books.length !== raw.books.length) errors.push('obligation.scope.books entries must be non-empty strings');
  if (books.length === 0) {
    // An empty scope is an obligation nothing can ever satisfy.
    errors.push('obligation.scope.books must name at least one book');
    return null;
  }

  return { books, label: raw.label === undefined || raw.label === null ? null : String(raw.label) };
}

export default validateBookLogEnrollment;
