import { useCallback, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'unlock' }));

const UNLOCK_PATH = 'api/v1/fitness/unlock';

/**
 * Drives a fingerprint-unlock request against POST /api/v1/fitness/unlock.
 *
 * The backend round-trip can take ~15s while the user places a finger on the
 * garage reader. Callers branch on the resolved `{ matched }` flag — requestUnlock
 * never rejects, so try/catch is unnecessary at the call site.
 *
 * @returns {{
 *   requestUnlock: (lockName: string) => Promise<{matched: boolean, userId?: string, reason?: string}>,
 *   state: 'idle' | 'scanning' | 'granted' | 'denied',
 *   activeLock: string | null,
 *   reset: () => void
 * }}
 */
export function useUnlock() {
  const [state, setState] = useState('idle');
  const [activeLock, setActiveLock] = useState(null);

  // Track the in-flight request so overlapping calls can be ignored without
  // relying on the async `state` value (which may not have flushed yet).
  const inFlightRef = useRef(null);

  const requestUnlock = useCallback((lockName) => {
    // Guard against overlapping requests: ignore a new call while one is in
    // flight and return a resolved {matched:false, reason:'busy'}.
    if (inFlightRef.current) {
      logger().warn('unlock.busy', { lock: lockName });
      return Promise.resolve({ matched: false, reason: 'busy' });
    }

    logger().info('unlock.requested', { lock: lockName });
    setState('scanning');
    setActiveLock(lockName);
    logger().debug('unlock.scanning', { lock: lockName });

    const promise = (async () => {
      try {
        const res = await DaylightAPI(UNLOCK_PATH, { lock: lockName });
        if (res && res.matched) {
          logger().info('unlock.granted', { lock: lockName, userId: res.userId });
          setState('granted');
          return { matched: true, userId: res.userId };
        }
        const reason = res?.reason;
        logger().info('unlock.denied', { lock: lockName, reason });
        setState('denied');
        return { matched: false, reason };
      } catch (err) {
        // Non-2xx responses throw from DaylightAPI; treat any failure as denied.
        logger().info('unlock.denied', { lock: lockName, reason: 'error', error: err?.message });
        setState('denied');
        return { matched: false, reason: 'error' };
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  const reset = useCallback(() => {
    logger().debug('unlock.reset');
    setState('idle');
    setActiveLock(null);
  }, []);

  return { requestUnlock, state, activeLock, reset };
}

export default useUnlock;
