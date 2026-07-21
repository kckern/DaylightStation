import { useEffect, useRef } from 'react';
import { firesOnGap } from './idleGap.js';

/**
 * useIdleGap — after `timeoutMinutes` with no input, the NEXT input (signalA or
 * signalB changing, OR a screen touch/keydown) calls `onIdleGap` once. Mirrors
 * the idle signals of useInactivityReturn. Disabled when timeoutMinutes <= 0.
 *
 * @param {*}      signalA  first activity signal (identity/value change = activity)
 * @param {*}      signalB  second activity signal (identity/value change = activity)
 * @param {number} timeoutMinutes  gap threshold in minutes
 * @param {() => void} onIdleGap
 */
export function useIdleGap(signalA, signalB, timeoutMinutes, onIdleGap) {
  const lastRef = useRef(Date.now());
  const onGapRef = useRef(onIdleGap);
  onGapRef.current = onIdleGap;
  const thresholdMs = (timeoutMinutes || 0) * 60_000;

  // One place to evaluate an input event: fire if the gap qualifies, then stamp.
  const onInput = useRef(() => {});
  onInput.current = () => {
    const now = Date.now();
    if (firesOnGap(lastRef.current, now, thresholdMs)) onGapRef.current?.();
    lastRef.current = now;
  };

  // Signal activity: any change to signalA / signalB is an input.
  useEffect(() => {
    if (thresholdMs <= 0) return;
    onInput.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signalA, signalB]);

  // Touch / keyboard activity.
  useEffect(() => {
    if (thresholdMs <= 0) return undefined;
    const bump = () => onInput.current();
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('pointerdown', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [thresholdMs]);
}

export default useIdleGap;
