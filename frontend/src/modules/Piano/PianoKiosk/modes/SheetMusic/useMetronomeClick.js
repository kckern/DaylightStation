import { useEffect, useRef } from 'react';

/**
 * useMetronomeClick — a tempo-locked tick scheduler. While `enabled`, calls
 * `onTick` every 60000/bpm ms; the caller makes the sound (this stays audio-
 * agnostic so it's testable). Restarts on bpm/enabled change; clears on unmount.
 */
export function useMetronomeClick({ enabled, bpm, onTick }) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!enabled || !(bpm > 0)) return undefined;
    const period = 60000 / bpm;
    const id = setInterval(() => onTickRef.current?.(), period);
    return () => clearInterval(id);
  }, [enabled, bpm]);
}

export default useMetronomeClick;
