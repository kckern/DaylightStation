/**
 * The `school` WebSocket events that change what the Portal shows. The day
 * board and the bank strip both re-read on these, scoped to the learner the
 * event names.
 *
 * `coins-changed` is the economy's fact (a mint, a convert, a pass bought,
 * consumed or refunded), forwarded by School's realtime adapter. A payout run
 * mints line by line, so it arrives in bursts: listeners coalesce
 * (`coalescer`) rather than re-reading per entry.
 */
export const COINS_CHANGED = 'coins-changed';
/** Quiet time after the last event of a burst before the re-read. */
export const COINS_COALESCE_MS = 750;
/** The longest a burst may hold a re-read back, however long it runs. */
export const COINS_MAX_WAIT_MS = 3_000;

export const SCHOOL_REFRESH_EVENTS = new Set([
  'session-issued',
  'session-grade-changed',
  'story-read',
  'book-log-changed',
  'piano-lesson-complete',
  'program-day-bypass-changed',
  COINS_CHANGED,
]);

/**
 * Trailing debounce with a ceiling: `poke()` runs `run` once events stop for
 * `waitMs`, but never later than `maxWaitMs` after the burst's first poke,
 * so a steady stream cannot starve the re-read. `cancel()` drops a pending run.
 */
export function coalescer(run, { waitMs = COINS_COALESCE_MS, maxWaitMs = COINS_MAX_WAIT_MS } = {}) {
  let timer = null;
  let firstAt = null;
  const fire = () => {
    timer = null;
    firstAt = null;
    run();
  };
  return {
    poke() {
      const now = Date.now();
      if (firstAt == null) firstAt = now;
      clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - now)));
    },
    cancel() {
      clearTimeout(timer);
      timer = null;
      firstAt = null;
    },
  };
}
