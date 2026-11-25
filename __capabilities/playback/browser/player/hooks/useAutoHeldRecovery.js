import { useEffect, useRef, useState } from 'react';
import { AUTO_RETRY_LIMIT, AUTO_RETRY_DELAY_SEC } from '../lib/heldRecoveryModel.js';
import { playbackLog } from '../lib/playbackLogger.js';

const RECOVERED_RESET_MS = 60_000;

/**
 * A held video on a surface nobody can press (PlaybackSurfaceContext 'none').
 *
 * Nobody can press Try again, so the Player does: every AUTO_RETRY_DELAY_SEC,
 * up to AUTO_RETRY_LIMIT times, then it moves to the next item if there is
 * one, or stops (the card says the video couldn't be loaded). The attempt count
 * belongs to the item and survives the brief un-held moment each retry makes.
 *
 * @param {object} p
 * @param {boolean} p.active   held, on a no-input surface
 * @param {string|null} p.mediaKey  the item; a new item starts a fresh count
 * @param {() => ({ok?: boolean, code?: string, retryAfterMs?: number}|void)} p.retry  a refused retry is not an attempt
 * @param {(() => void)|null} p.skip  null when nothing is next
 * @returns {{ attempt: number, retryInSec: number }}
 */
export function useAutoHeldRecovery({ active, mediaKey, retry, skip }) {
  // The count lives in a ref (the timer owns it); state only re-renders the card.
  const countRef = useRef({ mediaKey, attempt: 0, retryInSec: AUTO_RETRY_DELAY_SEC });
  if (countRef.current.mediaKey !== mediaKey) {
    countRef.current = { mediaKey, attempt: 0, retryInSec: AUTO_RETRY_DELAY_SEC };
  }
  // A recovery that holds (not held for RECOVERED_RESET_MS) earns the next
  // stall a fresh count; the brief un-held moment each retry makes does not.
  const inactiveSinceRef = useRef(null);
  if (!active) {
    if (inactiveSinceRef.current == null) inactiveSinceRef.current = Date.now();
  } else {
    if (inactiveSinceRef.current != null && Date.now() - inactiveSinceRef.current >= RECOVERED_RESET_MS) {
      countRef.current = { mediaKey, attempt: 0, retryInSec: AUTO_RETRY_DELAY_SEC };
    }
    inactiveSinceRef.current = null;
  }
  const [, setTick] = useState(0);
  const actRef = useRef({ retry, skip });
  actRef.current = { retry, skip };

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      const c = countRef.current;
      if (c.mediaKey !== mediaKey) return;
      if (c.retryInSec > 1) {
        c.retryInSec -= 1;
      } else if (c.attempt < AUTO_RETRY_LIMIT) {
        const result = actRef.current.retry?.();
        if (result?.ok === false) {
          // Refused (the shared ledger's rolling cap): not an attempt. Wait
          // out the cooldown it names, then ask again.
          const waitSec = Math.max(1, Math.ceil((Number(result.retryAfterMs) || AUTO_RETRY_DELAY_SEC * 1000) / 1000));
          c.retryInSec = waitSec;
          playbackLog('held-auto-retry-refused', { code: result.code ?? null, waitSec }, { level: 'info' });
        } else {
          c.attempt += 1;
          c.retryInSec = AUTO_RETRY_DELAY_SEC;
          playbackLog('held-auto-retry', { attempt: c.attempt, limit: AUTO_RETRY_LIMIT }, { level: 'info' });
        }
      } else if (c.attempt === AUTO_RETRY_LIMIT && actRef.current.skip) {
        c.attempt += 1;
        playbackLog('held-auto-skip', { attempts: AUTO_RETRY_LIMIT }, { level: 'info' });
        actRef.current.skip();
      } else {
        return;
      }
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [active, mediaKey]);

  const c = countRef.current;
  return { attempt: Math.min(c.attempt, AUTO_RETRY_LIMIT), retryInSec: c.retryInSec };
}
