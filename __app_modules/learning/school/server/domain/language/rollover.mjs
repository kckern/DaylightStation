/**
 * Study-day rollover (design §3). Pure: no I/O, no Date — `now` is injected.
 *
 * A study day is NOT a calendar day. It runs from `boundaryHour` to
 * `boundaryHour` (default 4am local), so a session that runs past midnight and
 * the evening it started in are the same day. Someone drilling at 1am has not
 * earned tomorrow's new sentences yet; the 2016 app got this right and it is
 * worth keeping.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The study date a timestamp falls in, as a day index.
 *
 * Shifts into local time, then back by `boundaryHour`, then floors to a day.
 * Two timestamps belong to the same study day exactly when this agrees.
 *
 * @param {number} epochMs
 * @param {object} [opts]
 * @param {number} [opts.boundaryHour=4]   local hour a new study day begins
 * @param {number} [opts.offsetMinutes=0]  local UTC offset; the application
 *                                         layer resolves the timezone, the
 *                                         domain only does arithmetic
 * @returns {number} day index (not a calendar date — only comparable to itself)
 */
export function studyDayIndex(epochMs, { boundaryHour = 4, offsetMinutes = 0 } = {}) {
  const local = epochMs + offsetMinutes * MINUTE_MS;
  return Math.floor((local - boundaryHour * 60 * MINUTE_MS) / DAY_MS);
}

/**
 * Whether the learner has earned a new study day.
 *
 * Both conditions must hold, and each rules out a distinct failure:
 *
 *  - **the queue is complete** — rolling with work outstanding would silently
 *    abandon it. Sentences mid-ladder would still be recoverable (the queue is
 *    derived), but the learner would have skipped a rung without being told.
 *  - **the boundary has passed** — otherwise finishing early would hand out
 *    tomorrow's sentences immediately, and a keen learner could burn the whole
 *    corpus in an afternoon. The spacing IS the method.
 *
 * An empty queue counts as complete: a learner who has retired every available
 * sentence should still advance rather than stall on a vacuous condition.
 *
 * @param {object} args
 * @param {Array<{done: boolean}>} args.queue
 * @param {number|null} args.lastActivity  epoch ms of the last logged event
 * @param {number} args.now                epoch ms
 * @param {number} [args.boundaryHour=4]
 * @param {number} [args.offsetMinutes=0]
 * @returns {{roll: boolean, reason: string}}
 */
export function shouldRollDay({
  queue = [],
  lastActivity,
  now,
  boundaryHour = 4,
  offsetMinutes = 0,
}) {
  const outstanding = queue.filter((entry) => !entry.done).length;
  if (outstanding > 0) return { roll: false, reason: 'queue-incomplete' };

  // Never studied at all — there is no previous day to roll out of. The first
  // day is created by the service, not by a rollover.
  if (lastActivity == null) return { roll: false, reason: 'no-activity' };

  const opts = { boundaryHour, offsetMinutes };
  if (studyDayIndex(now, opts) <= studyDayIndex(lastActivity, opts)) {
    return { roll: false, reason: 'before-boundary' };
  }
  return { roll: true, reason: 'earned' };
}
