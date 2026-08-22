import { useEffect, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { isCurfewActive } from './pianoCurfew.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-curfew' });
  return _logger;
}

// The kiosk is a wall tablet that stays on the menu for days, so the boundary
// has to be crossed live — nothing reloads at 19:00. A 30s poll puts the
// greyout within half a minute of the cut-off, which is as precise as a
// household curfew needs to be.
const TICK_MS = 30_000;

/**
 * Live curfew state for the kiosk: true while `now` is inside the configured
 * window. Re-evaluates on a timer so the menu greys out (and comes back in the
 * morning) without a reload.
 *
 * @param {{enabled?: boolean, start?: string, end?: string}|null} curfew
 * @returns {boolean}
 */
export function usePianoCurfew(curfew) {
  const [active, setActive] = useState(() => isCurfewActive(new Date(), curfew));

  useEffect(() => {
    const evaluate = () => {
      setActive((was) => {
        const now = isCurfewActive(new Date(), curfew);
        if (now !== was) {
          logger().info('piano.curfew.change', { active: now, start: curfew?.start, end: curfew?.end });
        }
        return now;
      });
    };
    evaluate(); // config changed → re-evaluate immediately, don't wait a tick
    const id = setInterval(evaluate, TICK_MS);
    return () => clearInterval(id);
  }, [curfew?.enabled, curfew?.start, curfew?.end]); // eslint-disable-line react-hooks/exhaustive-deps

  return active;
}

export default usePianoCurfew;
