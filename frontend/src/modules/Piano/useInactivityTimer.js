import { useState, useEffect, useRef } from 'react';

const GRACE_PERIOD_MS = 10000;
const COUNTDOWN_MS = 30000;

/**
 * Detects piano inactivity and triggers close after grace period + countdown.
 *
 * @param {Map} activeNotes
 * @param {Array} noteHistory
 * @param {boolean} isAnyGame - true if any game mode is active (suppresses timer)
 * @param {function} onClose - called when countdown reaches zero
 * @returns {{ inactivityState: string, countdownProgress: number }}
 */
export function useInactivityTimer(activeNotes, noteHistory, isAnyGame, onClose) {
  const [inactivityState, setInactivityState] = useState('active');
  const [countdownProgress, setCountdownProgress] = useState(100);
  const lastNoteOffRef = useRef(null);
  const timerRef = useRef(null);

  // Track when all notes are released
  useEffect(() => {
    if (activeNotes.size === 0 && noteHistory.length > 0) {
      lastNoteOffRef.current = Date.now();
    } else if (activeNotes.size > 0) {
      lastNoteOffRef.current = null;
      setInactivityState('active');
      setCountdownProgress(100);
    }
  }, [activeNotes.size, noteHistory.length]);

  // Inactivity detection
  useEffect(() => {
    const checkInactivity = () => {
      if (isAnyGame) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
      if (activeNotes.size > 0) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }
      if (!lastNoteOffRef.current) {
        setInactivityState('active');
        setCountdownProgress(100);
        return;
      }

      const elapsed = Date.now() - lastNoteOffRef.current;
      if (elapsed < GRACE_PERIOD_MS) {
        setInactivityState('active');
        setCountdownProgress(100);
      } else if (elapsed < GRACE_PERIOD_MS + COUNTDOWN_MS) {
        setInactivityState('countdown');
        const countdownElapsed = elapsed - GRACE_PERIOD_MS;
        const progress = 100 - (countdownElapsed / COUNTDOWN_MS) * 100;
        setCountdownProgress(Math.max(0, progress));
      } else {
        if (onClose) onClose();
      }
    };

    timerRef.current = setInterval(checkInactivity, 100);
    return () => clearInterval(timerRef.current);
  }, [onClose, activeNotes.size, isAnyGame]);

  return { inactivityState, countdownProgress };
}
