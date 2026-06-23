import { useEffect, useRef } from 'react';

/**
 * useInactivityReturn — after N idle minutes (no MIDI notes, no touch/pointer),
 * invoke onIdle (the kiosk returns to its menu). Borrows the screensaver/
 * inactivity *pattern* from screen-framework without mounting a full screen.
 *
 * @param {Map} activeNotes - live notes (any change counts as activity)
 * @param {number} historyLen - noteHistory length (grows on each note = activity)
 * @param {number} minutes - idle threshold; <= 0 disables
 * @param {() => void} onIdle
 */
export function useInactivityReturn(activeNotes, historyLen, minutes, onIdle) {
  const lastActivityRef = useRef(Date.now());
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // MIDI activity bumps the timer.
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [activeNotes, historyLen]);

  // Touch/pointer activity bumps the timer.
  useEffect(() => {
    if (!minutes || minutes <= 0) return undefined;
    const bump = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener('pointerdown', bump, true);
    window.addEventListener('keydown', bump, true);
    return () => {
      window.removeEventListener('pointerdown', bump, true);
      window.removeEventListener('keydown', bump, true);
    };
  }, [minutes]);

  // Poll for the idle threshold.
  useEffect(() => {
    if (!minutes || minutes <= 0) return undefined;
    const thresholdMs = minutes * 60_000;
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= thresholdMs) {
        lastActivityRef.current = Date.now(); // avoid repeat firing
        onIdleRef.current?.();
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [minutes]);
}

export default useInactivityReturn;
