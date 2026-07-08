import { useEffect, useState } from 'react';
import moment from 'moment';

/**
 * Today's date key ('YYYY-MM-DD'), updating when the calendar day changes.
 * Memoized chart options that embed "now" re-key on this instead of
 * freezing at their last rebuild.
 */
export function useToday(checkMs = 60000) {
  const [today, setToday] = useState(() => moment().format('YYYY-MM-DD'));

  useEffect(() => {
    const id = setInterval(() => {
      const next = moment().format('YYYY-MM-DD');
      setToday((prev) => (prev === next ? prev : next));
    }, checkMs);
    return () => clearInterval(id);
  }, [checkMs]);

  return today;
}
