import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useArmedAction — a two-tap confirm for a momentary, destructive-ish action on
 * a touch kiosk. The first `trigger()` arms; a second `trigger()` within `armMs`
 * fires `fn` (and returns its result — e.g. a promise); otherwise it auto-disarms.
 *
 * Lifted from the settings sheet so the connect gate can share it: the connect
 * screen is the HIGHEST lock-out-risk surface (no piano paired → no BLE/MIDI
 * wake; once the backlight is off, touch is dead → only FKB REST recovers it),
 * so a stray tap MUST NOT blank the screen.
 *
 * @param {() => any} fn        Action to run on confirm; its return is forwarded.
 * @param {{armMs?: number}} [opts]
 * @returns {{armed: boolean, trigger: () => any, reset: () => void}}
 */
export function useArmedAction(fn, { armMs = 3000 } = {}) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const timer = useRef(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const set = useCallback((v) => { armedRef.current = v; setArmed(v); }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    set(false);
  }, [set]);

  const trigger = useCallback(() => {
    if (armedRef.current) {
      clearTimeout(timer.current);
      set(false);
      return fnRef.current();
    }
    set(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set(false), armMs);
    return undefined;
  }, [armMs, set]);

  return { armed, trigger, reset };
}

export default useArmedAction;
