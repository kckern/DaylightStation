import { useState, useEffect } from 'react';
import { localDateKey } from '../lib/calendarDay.js';
import getLogger from '../lib/logging/Logger.js';
import { msUntilNextMidnight } from './useDayOfWeek.js';

export { localDateKey };

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useLocalDate' });
  return _logger;
}

/**
 * Reactive local date ('YYYY-MM-DD'), updated at local midnight without a
 * reload — the date-gated sibling of useDayOfWeek (e.g. a nav tab that only
 * appears on October 31st).
 *
 * @returns {string} Current local date.
 */
export default function useLocalDate() {
  const [date, setDate] = useState(() => localDateKey());

  useEffect(() => {
    let timerId;
    const schedule = () => {
      const delay = Math.max(1000, msUntilNextMidnight());
      timerId = setTimeout(() => {
        const next = localDateKey();
        setDate((prev) => {
          if (prev !== next) logger().info('date-rollover', { from: prev, to: next });
          return next;
        });
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timerId);
  }, []);

  return date;
}
