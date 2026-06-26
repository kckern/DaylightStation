import { useEffect, useRef } from 'react';
import { firesOnGap } from './whoIsPlaying.js';

/**
 * useWhoIsPlaying — after `timeoutMinutes` with no input, the NEXT input (a MIDI
 * note OR a screen touch/keydown) calls `onIdleGap` once. Mirrors the idle
 * signals of useInactivityReturn. Disabled when timeoutMinutes <= 0.
 *
 * @param {Map}    activeNotes  live notes (identity changes = MIDI activity)
 * @param {number} historyLen   noteHistory length (grows per note = activity)
 * @param {number} timeoutMinutes  gap threshold in minutes
 * @param {() => void} onIdleGap
 */
export function useWhoIsPlaying(activeNotes, historyLen, timeoutMinutes, onIdleGap) {
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

  // MIDI activity: any change to activeNotes / historyLen is an input.
  useEffect(() => {
    if (thresholdMs <= 0) return;
    onInput.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNotes, historyLen]);

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

export default useWhoIsPlaying;
