import { Clock } from '../../backend/src/0_system/clock/Clock.mjs';

/**
 * Create a frozen clock for testing.
 * @param {string} date - ISO date string to freeze at
 * @returns {Clock}
 */
export function frozenClock(date = '2025-06-01') {
  const clock = new Clock();
  clock.freeze(date);
  return clock;
}

/**
 * Create a clock and advance it through a sequence of steps,
 * calling a callback at each step.
 * @param {string} startDate
 * @param {Array<{advance?: string, fn?: Function}>} steps
 * @returns {Promise<{clock: Clock, results: Array}>}
 */
export async function walkClock(startDate, steps) {
  const clock = frozenClock(startDate);
  const results = [];
  for (const step of steps) {
    if (step.advance) clock.advance(step.advance);
    if (step.fn) results.push(await step.fn(clock));
  }
  return { clock, results };
}

export { Clock };
