import { useCallback, useEffect, useRef } from 'react';
import { comboNotesForKeyboard } from '../launcher/comboForKeyboard.js';

const COMBO_WINDOW_MS = 300;
const EXIT_HOLD_MS = 2000;

/**
 * Physical outer keys held for two seconds exit. Optional result navigation
 * accepts any fresh key, after full release; an outer key waits 300ms so it
 * cannot retry before its partner completes the exit gesture.
 *
 * `resetKey` identifies a new attempt. `continueEnabled` identifies a result
 * panel. Both transitions re-arm only after every preceding key is released.
 */
export function usePianoExitGesture({ activeNotes, keyboard, onExit, enabled = true,
  onContinue, continueEnabled = false, resetKey = null }) {
  const [low, high] = comboNotesForKeyboard(keyboard);
  const canExit = typeof onExit === 'function';
  const callbacks = useRef(null);
  callbacks.current = { onExit, onContinue, enabled, continueEnabled };
  const state = useRef({});
  const retryTimer = useRef(null);
  const exitTimer = useRef(null);
  const cancelRetry = () => { clearTimeout(retryTimer.current); retryTimer.current = null; };
  const cancelExit = () => { clearTimeout(exitTimer.current); exitTimer.current = null; };

  useEffect(() => {
    cancelRetry(); cancelExit();
    state.current = { previous: new Set(), exitArmed: false, exitFired: false,
      released: false, continued: false, combo: false };
    return () => { cancelRetry(); cancelExit(); };
  }, [enabled, resetKey, low, high, canExit]);

  useEffect(() => {
    cancelRetry();
    state.current.released = false;
    state.current.continued = false;
  }, [continueEnabled]);

  useEffect(() => {
    if (!enabled) return;
    const held = new Set(activeNotes instanceof Map ? activeNotes.keys() : []);
    const current = state.current;
    const fresh = [...held].filter(note => !current.previous.has(note));
    current.previous = held;
    if (!held.size) {
      cancelExit();
      current.exitArmed = true;
      current.released = true;
      current.combo = false;
      return;
    }
    if (canExit && held.has(low) && held.has(high) && current.exitArmed && !current.exitFired) {
      cancelRetry();
      current.combo = true;
      if (exitTimer.current === null) exitTimer.current = setTimeout(() => {
        exitTimer.current = null;
        current.exitFired = true;
        current.continued = true;
        callbacks.current.onExit?.();
      }, EXIT_HOLD_MS);
      return;
    }
    cancelExit();
    if (current.combo || current.exitFired || !continueEnabled || !current.released
      || current.continued || !fresh.length) return;
    const proceed = () => {
      retryTimer.current = null;
      if (current.combo || current.exitFired || current.continued || !callbacks.current.enabled
        || !callbacks.current.continueEnabled) return;
      current.continued = true;
      callbacks.current.onContinue?.();
    };
    if (canExit && (held.has(low) || held.has(high))) {
      if (retryTimer.current === null) retryTimer.current = setTimeout(proceed, COMBO_WINDOW_MS);
    } else {
      cancelRetry();
      proceed();
    }
  }, [activeNotes, continueEnabled, enabled, resetKey, low, high, canExit]);

  const isExitKey = useCallback(midi => canExit && (midi === low || midi === high), [low, high, canExit]);
  return { exitHeld: Boolean(enabled && canExit && activeNotes?.has(low) && activeNotes?.has(high)), isExitKey };
}
