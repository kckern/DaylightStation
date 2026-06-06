import { useState, useEffect } from 'react';
import getLogger from '../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useDayOfWeek' });
  return _logger;
}

/**
 * Milliseconds from `now` until the next local midnight (00:00:00.000).
 * Uses setHours(24,...) which JS normalizes to the start of the following day.
 */
export function msUntilNextMidnight(now = new Date()) {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * Reactive day-of-week (0=Sunday … 6=Saturday, matching `Date.getDay()`).
 *
 * Crucially, this updates itself at local midnight WITHOUT a page reload, so a
 * long-running kiosk session left open overnight re-evaluates day-gated UI (e.g.
 * a "Saturdays only" nav tab vanishes the instant the clock ticks to Sunday).
 * It re-reads the actual day in the timer callback rather than assuming +1, so
 * a timer that fires slightly early/late still lands on the correct day, then
 * reschedules for the following midnight.
 *
 * @returns {number} Current local day-of-week.
 */
export default function useDayOfWeek() {
  const [day, setDay] = useState(() => new Date().getDay());

  useEffect(() => {
    let timerId;
    const schedule = () => {
      // Floor at 1s so a clock that's already at/just-past midnight can't busy-loop.
      const delay = Math.max(1000, msUntilNextMidnight());
      timerId = setTimeout(() => {
        const next = new Date().getDay();
        setDay((prev) => {
          if (prev !== next) logger().info('day-rollover', { from: prev, to: next });
          return next;
        });
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timerId);
  }, []);

  return day;
}
