import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

/**
 * Arm a watchdog after a "close requested" signal. If "close completed" does
 * not arrive within `timeoutMs`, log an error and invoke `onTimeout`.
 *
 * Why: the 2026-05-22 fitness session captured a 27.6s gap between
 * `fitness.player.close.requested` and `fitness.player.close.initiated`.
 * During that window the user saw a frozen UI and started clicking the video
 * element trying to recover. A 5s watchdog forces an escalation path so the
 * user is never stuck waiting on a silent close.
 *
 * Usage:
 *   const { requested, completed } = useCloseWatchdog({ timeoutMs: 5000, onTimeout });
 *   // when handleClose fires:
 *   requested({ sessionId, voiceMemoOverlayOpen });
 *   // when executeClose finishes:
 *   completed({ sessionId });
 *
 * @param {object} args
 * @param {number} [args.timeoutMs=5000] - Watchdog period.
 * @param {(ctx: object) => void} args.onTimeout - Escalation callback. Receives
 *   the original requested payload plus `{ elapsedMs, timeoutMs }`.
 * @returns {{ requested: (payload?: object) => void, completed: (payload?: object) => void }}
 */
export function useCloseWatchdog({ timeoutMs = 5000, onTimeout }) {
  const timerRef = useRef(null);
  const armedRef = useRef(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    armedRef.current = null;
  }, []);

  const requested = useCallback((payload = {}) => {
    clear();
    armedRef.current = { armedAt: Date.now(), ...payload };
    timerRef.current = setTimeout(() => {
      const ctx = armedRef.current || {};
      getLogger().error('fitness.player.close.watchdog_fired', {
        ...ctx,
        elapsedMs: ctx.armedAt ? Date.now() - ctx.armedAt : null,
        timeoutMs,
      });
      try { onTimeout?.(ctx); } finally { clear(); }
    }, timeoutMs);
  }, [clear, onTimeout, timeoutMs]);

  const completed = useCallback((payload = {}) => {
    clear();
  }, [clear]);

  useEffect(() => clear, [clear]);

  return { requested, completed };
}

export default useCloseWatchdog;
