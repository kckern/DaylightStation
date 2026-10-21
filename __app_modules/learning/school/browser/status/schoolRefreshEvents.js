/**
 * The `school` WebSocket events that change what the Portal shows. The day
 * board and the bank strip both re-read on these, scoped to the learner the
 * event names.
 *
 * `coins-changed` is the economy's fact (a mint, a convert, a pass bought,
 * consumed or refunded), forwarded by School's realtime adapter. A payout run
 * mints line by line, so it arrives in bursts: listeners coalesce it
 * (`COINS_COALESCE_MS`) rather than re-reading per entry.
 */
export const COINS_CHANGED = 'coins-changed';
export const COINS_COALESCE_MS = 750;

export const SCHOOL_REFRESH_EVENTS = new Set([
  'session-issued',
  'session-grade-changed',
  'story-read',
  'book-log-changed',
  'piano-lesson-complete',
  'program-day-bypass-changed',
  COINS_CHANGED,
]);
