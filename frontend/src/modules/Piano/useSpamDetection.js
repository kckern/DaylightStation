import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { getChildLogger } from '../../lib/logging/singleton.js';
import {
  detectNoteCountSpam,
  detectDenseClusterSpam,
  detectRapidFireSpam,
} from './spamDetection.js';

// ─── Constants ────────────────────────────────────────────────

const BLACKOUT_KEY = 'piano-spam-blackout';
const BLACKOUT_DURATION_MS = 90 * 1000;          // 90 seconds
const WARNING_DISPLAY_MS = 3000;                 // 3 seconds
const ESCALATION_WINDOW_MS = 60000;              // 60 seconds
const STRIKES_TO_BLACKOUT = 3;
const RAPID_FIRE_COOLDOWN_MS = 3000;             // 3 seconds between rapid-fire triggers

// ─── localStorage helper ──────────────────────────────────────

/**
 * Read blackout expiry from localStorage and return remaining ms.
 * Returns 0 if expired or absent. Auto-cleans expired entries.
 */
function getBlackoutRemaining() {
  try {
    const raw = localStorage.getItem(BLACKOUT_KEY);
    if (!raw) return 0;
    const expiresAt = Number(raw);
    if (Number.isNaN(expiresAt)) {
      localStorage.removeItem(BLACKOUT_KEY);
      return 0;
    }
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      localStorage.removeItem(BLACKOUT_KEY);
      return 0;
    }
    return remaining;
  } catch {
    return 0;
  }
}

// ─── Hook ─────────────────────────────────────────────────────

/**
 * Watches activeNotes and noteHistory for spam patterns.
 * Escalates through warning -> blackout states with localStorage persistence.
 *
 * @param {Map} activeNotes - Currently held MIDI notes
 * @param {Array<{startTime: number}>} noteHistory - Chronological note events
 * @returns {{ spamState: string, warningVisible: boolean, blackoutRemaining: number, spamEventCount: number }}
 */
export function useSpamDetection(activeNotes, noteHistory) {
  const logger = useMemo(() => getChildLogger({ component: 'spam-detection' }), []);

  // ─── State ────────────────────────────────────────────────

  const [warningVisible, setWarningVisible] = useState(false);
  const [blackoutRemaining, setBlackoutRemaining] = useState(() => getBlackoutRemaining());
  const [spamEventCount, setSpamEventCount] = useState(0);

  // ─── Refs ─────────────────────────────────────────────────

  const spamEventsRef = useRef([]);           // timestamps of spam events within escalation window
  const warningTimerRef = useRef(null);       // timeout ID for warning auto-dismiss
  const noteCountFiredRef = useRef(false);    // debounce: has note-count signal fired this burst?
  const denseClusterFiredRef = useRef(false); // debounce: has dense-cluster signal fired this burst?
  const rapidFireCooldownRef = useRef(0);     // timestamp: rapid-fire won't re-trigger until after this

  // ─── Blackout countdown ticker ────────────────────────────

  useEffect(() => {
    if (blackoutRemaining <= 0) return;

    const interval = setInterval(() => {
      const remaining = getBlackoutRemaining();
      setBlackoutRemaining(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [blackoutRemaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── recordSpamEvent callback ─────────────────────────────

  const recordSpamEvent = useCallback((signal) => {
    const now = Date.now();

    // Deduplicate: if multiple signals fire from the same physical event
    // (e.g., a fist-smash triggers both note-count and dense-cluster),
    // only count it as one strike.
    const lastEvent = spamEventsRef.current[spamEventsRef.current.length - 1];
    if (lastEvent && now - lastEvent < 100) {
      logger.debug('spam.deduplicated', { signal });
      return;
    }

    logger.warn('spam.detected', { signal });

    // Prune events older than escalation window
    spamEventsRef.current = spamEventsRef.current.filter(
      (t) => now - t < ESCALATION_WINDOW_MS
    );

    // Record new event
    spamEventsRef.current.push(now);

    const count = spamEventsRef.current.length;
    setSpamEventCount(count);

    if (count >= STRIKES_TO_BLACKOUT) {
      // Trigger blackout
      const expiresAt = now + BLACKOUT_DURATION_MS;
      try {
        localStorage.setItem(BLACKOUT_KEY, String(expiresAt));
      } catch { /* localStorage full — blackout still applies in-memory */ }

      logger.warn('spam.blackout', { duration: BLACKOUT_DURATION_MS });
      spamEventsRef.current = [];
      setSpamEventCount(0);
      setBlackoutRemaining(BLACKOUT_DURATION_MS);
      setWarningVisible(false);
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
        warningTimerRef.current = null;
      }
      return;
    }

    // Show warning (not yet blackout)
    setWarningVisible(true);

    // Clear any existing warning timer
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
    }

    warningTimerRef.current = setTimeout(() => {
      setWarningVisible(false);
      warningTimerRef.current = null;
    }, WARNING_DISPLAY_MS);
  }, [logger]);

  // ─── Signal A: note count ─────────────────────────────────

  useEffect(() => {
    if (blackoutRemaining > 0) return;

    const isSpam = detectNoteCountSpam(activeNotes);

    if (isSpam && !noteCountFiredRef.current) {
      noteCountFiredRef.current = true;
      recordSpamEvent('note-count');
    } else if (!isSpam) {
      // Reset debounce when notes drop below threshold
      noteCountFiredRef.current = false;
    }
  }, [activeNotes, blackoutRemaining, recordSpamEvent]);

  // ─── Signal B: dense cluster ──────────────────────────────

  useEffect(() => {
    if (blackoutRemaining > 0) return;

    const isSpam = detectDenseClusterSpam(activeNotes);

    if (isSpam && !denseClusterFiredRef.current) {
      denseClusterFiredRef.current = true;
      recordSpamEvent('dense-cluster');
    } else if (!isSpam) {
      // Reset debounce when cluster dissipates
      denseClusterFiredRef.current = false;
    }
  }, [activeNotes, blackoutRemaining, recordSpamEvent]);

  // ─── Signal C: rapid fire ─────────────────────────────────

  useEffect(() => {
    if (blackoutRemaining > 0) return;

    const now = Date.now();
    if (now < rapidFireCooldownRef.current) return;

    const isSpam = detectRapidFireSpam(noteHistory, now);

    if (isSpam) {
      rapidFireCooldownRef.current = now + RAPID_FIRE_COOLDOWN_MS;
      recordSpamEvent('rapid-fire');
    }
  }, [noteHistory, blackoutRemaining, recordSpamEvent]);

  // ─── Cleanup warning timer on unmount ─────────────────────

  useEffect(() => {
    return () => {
      if (warningTimerRef.current) {
        clearTimeout(warningTimerRef.current);
      }
    };
  }, []);

  // ─── Computed state ───────────────────────────────────────

  const spamState = blackoutRemaining > 0
    ? 'blackout'
    : warningVisible
      ? 'warning'
      : 'clear';

  return {
    spamState,
    warningVisible,
    blackoutRemaining,
    spamEventCount,
  };
}

export default useSpamDetection;
