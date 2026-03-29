import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket';
import { getChildLogger } from '../../lib/logging/singleton.js';

const MAX_HISTORY_SIZE = 500;
const STALE_NOTE_MS = 10000;
const DISPLAY_DURATION = 8000;

// Dev keyboard mapping: number row keys to MIDI notes (C4-G5)
const DEV_KEY_MAP = {
  '1': 60, '2': 62, '3': 64, '4': 65, '5': 67,
  '6': 69, '7': 71, '8': 72, '9': 74, '0': 76,
  '-': 77, '=': 79
};

/**
 * Find the last entry in history matching a note number with no endTime.
 * Scans backward for O(1) typical case (most recent match is near the end).
 */
function findLastActive(history, noteNum) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].note === noteNum && !history[i].endTime) return i;
  }
  return -1;
}

/**
 * Close an active note in-place by index, returning a new array.
 */
function closeNote(history, idx, endTime) {
  const next = [...history];
  next[idx] = { ...next[idx], endTime };
  return next;
}

/**
 * Trim history: drop expired completed notes, keep all active + recent completed.
 */
function trimHistory(history, now) {
  const cutoff = now - DISPLAY_DURATION;
  const trimmed = history.filter(n => !n.endTime || n.endTime > cutoff);
  if (trimmed.length > MAX_HISTORY_SIZE) {
    // Keep active notes + most recent completed
    const active = trimmed.filter(n => !n.endTime);
    const completed = trimmed.filter(n => n.endTime);
    return [...completed.slice(-(MAX_HISTORY_SIZE - active.length)), ...active];
  }
  return trimmed;
}

/**
 * Core note event handler — pure function on history array.
 * Returns new history array. No refs, no side-channel state.
 */
function handleNoteOn(history, note, velocity, startTime) {
  // Close any existing active entry for this pitch (retrigger)
  const activeIdx = findLastActive(history, note);
  let next = activeIdx >= 0 ? closeNote(history, activeIdx, startTime) : history;
  return [...next, { note, velocity, startTime, endTime: null }];
}

function handleNoteOff(history, note, endTime) {
  const activeIdx = findLastActive(history, note);
  if (activeIdx < 0) return history; // No matching active note — ignore
  return closeNote(history, activeIdx, endTime);
}

/**
 * React hook to subscribe to MIDI events from the piano recorder.
 *
 * Single source of truth: noteHistory array. No refs for index tracking.
 * activeNotes Map is derived state for keyboard highlighting only.
 */
export function useMidiSubscription() {
  const logger = useMemo(() => getChildLogger({ app: 'piano-visualizer' }), []);
  const [activeNotes, setActiveNotes] = useState(new Map());
  const [sustainPedal, setSustainPedal] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [noteHistory, setNoteHistory] = useState([]);

  const handleMidiMessage = useCallback((data) => {
    if (data.topic !== 'midi') return;

    const { type, data: eventData } = data;

    if (type === 'note') {
      const { event, note, velocity } = eventData;

      if (event === 'note_on' && velocity > 0) {
        const startTime = Date.now();
        logger.info('note.on', { note, velocity });

        setActiveNotes(prev => {
          if (prev.has(note)) {
            logger.warn('note.retrigger', { note, heldMs: startTime - prev.get(note).timestamp });
          }
          const next = new Map(prev);
          next.set(note, { velocity, timestamp: startTime });
          return next;
        });

        setNoteHistory(prev => handleNoteOn(prev, note, velocity, startTime));
      } else {
        // note_off (or note_on with velocity 0)
        const endTime = Date.now();
        logger.info('note.off', { note });

        setActiveNotes(prev => {
          if (!prev.has(note)) {
            logger.warn('note.off.orphan', { note });
          }
          const next = new Map(prev);
          next.delete(note);
          return next;
        });

        setNoteHistory(prev => {
          const idx = findLastActive(prev, note);
          if (idx < 0) {
            logger.warn('note.off.noHistory', { note });
            return prev;
          }
          return closeNote(prev, idx, endTime);
        });
      }
    }

    if (type === 'control' && eventData.controlName === 'sustain') {
      setSustainPedal(eventData.value >= 64);
    }

    if (type === 'session') {
      setSessionInfo(eventData);
      if (eventData.event === 'session_start') {
        setActiveNotes(new Map());
        setSustainPedal(false);
        setNoteHistory([]);
      }
    }
  }, [logger]);

  useWebSocketSubscription('midi', handleMidiMessage, [handleMidiMessage]);

  // Periodic cleanup: expire stale active notes + trim old completed notes
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();

      // Release stale active notes (lost note_off)
      setActiveNotes(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [note, { timestamp }] of prev) {
          if (now - timestamp > STALE_NOTE_MS) {
            next.delete(note);
            changed = true;
            logger.warn('note.stale.activeMap', { note, heldMs: now - timestamp });
          }
        }
        return changed ? next : prev;
      });

      // Close stale notes in history + trim expired entries
      setNoteHistory(prev => {
        let history = prev;
        let changed = false;
        const staleNotes = [];

        // Close any notes active longer than STALE_NOTE_MS
        for (let i = history.length - 1; i >= 0; i--) {
          if (!history[i].endTime && (now - history[i].startTime) > STALE_NOTE_MS) {
            staleNotes.push({ note: history[i].note, heldMs: now - history[i].startTime });
            history = closeNote(history, i, now);
            changed = true;
          }
        }

        if (staleNotes.length > 0) {
          logger.warn('note.stale.history', { count: staleNotes.length, notes: staleNotes });
        }

        // Log active note count every sweep for visibility
        const activeCount = history.filter(n => !n.endTime).length;
        if (activeCount > 0) {
          logger.debug('note.sweep', { activeInHistory: activeCount, totalHistory: history.length });
        }

        // Trim expired completed notes
        const trimmed = trimHistory(history, now);
        if (trimmed.length !== history.length) changed = true;

        return changed ? trimmed : prev;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [logger]);

  // Dev keyboard input (localhost only)
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') return;

    const pressedKeys = new Set();

    const handleKeyDown = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note || pressedKeys.has(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      pressedKeys.add(e.key);
      const startTime = Date.now();

      setActiveNotes(prev => {
        const next = new Map(prev);
        next.set(note, { velocity: 80, timestamp: startTime });
        return next;
      });
      setNoteHistory(prev => handleNoteOn(prev, note, 80, startTime));
    };

    const handleKeyUp = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note) return;
      e.preventDefault();
      e.stopPropagation();
      pressedKeys.delete(e.key);
      const endTime = Date.now();

      setActiveNotes(prev => {
        const next = new Map(prev);
        next.delete(note);
        return next;
      });
      setNoteHistory(prev => handleNoteOff(prev, note, endTime));
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

  return { activeNotes, sustainPedal, sessionInfo, isPlaying: activeNotes.size > 0, noteHistory };
}

export default useMidiSubscription;
