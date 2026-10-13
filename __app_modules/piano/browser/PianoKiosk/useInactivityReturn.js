import { useEffect, useRef } from 'react';
import { activitySignal } from './activitySignal.js';

/**
 * useInactivityReturn — after N idle minutes (no MIDI notes, no touch/pointer),
 * invoke onIdle (the kiosk returns to its menu). Borrows the screensaver/
 * inactivity *pattern* from screen-framework without mounting a full screen.
 *
 * Also bumps the shared `activitySignal` (frontend/src/modules/Piano/PianoKiosk/
 * activitySignal.js) at the same three places it bumps its own private ref, so
 * anything else that needs seconds-granularity activity (e.g. a game-budget
 * meter that must pause AND resume) can subscribe without this hook's own
 * minutes-granularity onIdle contract changing at all — that contract is
 * untouched by this addition.
 *
 * @param {Map} activeNotes - live notes (any change counts as activity)
 * @param {number} historyLen - noteHistory length (grows on each note = activity)
 * @param {number} minutes - idle threshold; <= 0 disables
 * @param {() => void} onIdle
 * @param {boolean} [keepAlive=false] - when true, active playback continuously
 *   resets the idle clock so the kiosk never navigates away mid-media.
 */
export function useInactivityReturn(activeNotes, historyLen, minutes, onIdle, keepAlive = false) {
  const lastActivityRef = useRef(Date.now());
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  // MIDI activity bumps the timer.
  useEffect(() => {
    lastActivityRef.current = Date.now();
    activitySignal.bump();
  }, [activeNotes, historyLen]);

  // Active playback continuously counts as activity.
  useEffect(() => {
    if (!keepAlive) return undefined;
    lastActivityRef.current = Date.now();
    activitySignal.bump();
    const id = setInterval(() => {
      lastActivityRef.current = Date.now();
      activitySignal.bump();
    }, 5_000);
    return () => clearInterval(id);
  }, [keepAlive]);

  // Touch/pointer activity bumps the timer.
  useEffect(() => {
    if (!minutes || minutes <= 0) return undefined;
    const bump = () => {
      lastActivityRef.current = Date.now();
      activitySignal.bump();
    };
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
