import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useWebSocketSubscription } from '../../hooks/useWebSocket';
import { getChildLogger } from '../../lib/logging/singleton.js';

const MAX_HISTORY_SIZE = 500; // Keep last 500 notes for waterfall
const STALE_NOTE_MS = 10000; // Auto-release notes held longer than 10s (likely lost note_off)

// Dev keyboard mapping: number row keys to MIDI notes (C4-G5)
const DEV_KEY_MAP = {
  '1': 60, // C4
  '2': 62, // D4
  '3': 64, // E4
  '4': 65, // F4
  '5': 67, // G4
  '6': 69, // A4
  '7': 71, // B4
  '8': 72, // C5
  '9': 74, // D5
  '0': 76, // E5
  '-': 77, // F5
  '=': 79  // G5
};

/**
 * React hook to subscribe to MIDI events from the piano recorder
 *
 * @returns {{
 *   activeNotes: Map<number, { velocity: number, timestamp: number }>,
 *   sustainPedal: boolean,
 *   sessionInfo: object|null,
 *   isPlaying: boolean,
 *   noteHistory: Array<{ note: number, velocity: number, startTime: number, endTime: number|null }>
 * }}
 */
export function useMidiSubscription() {
  const logger = useMemo(() => getChildLogger({ app: 'piano-visualizer' }), []);
  const [activeNotes, setActiveNotes] = useState(new Map());
  const [sustainPedal, setSustainPedal] = useState(false);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [noteHistory, setNoteHistory] = useState([]);
  const activeNoteIds = useRef(new Map()); // Map note number to history index

  const handleMidiMessage = useCallback((data) => {
    // Filter for midi topic
    if (data.topic !== 'midi') return;

    const { type, data: eventData } = data;
    logger.info('piano.visualizer.midi', { type, event: eventData?.event, note: eventData?.note });

    if (type === 'note') {
      const { event, note, velocity } = eventData;
      logger.info('piano.visualizer.note', { event, note, velocity });

      if (event === 'note_on' && velocity > 0) {
        // Note on - use single timestamp for consistency
        const startTime = Date.now();

        setActiveNotes(prev => {
          const next = new Map(prev);
          next.set(note, { velocity, timestamp: startTime });
          return next;
        });

        // Add to history
        setNoteHistory(prev => {
          const newNote = {
            note,
            velocity,
            startTime,
            endTime: null
          };
          const newHistory = [...prev, newNote];
          // Keep history size bounded — but preserve active notes (endTime: null)
          if (newHistory.length > MAX_HISTORY_SIZE) {
            const active = newHistory.filter(n => !n.endTime);
            const completed = newHistory.filter(n => n.endTime);
            const trimmed = completed.slice(-(MAX_HISTORY_SIZE - active.length));
            return [...trimmed, ...active];
          }
          return newHistory;
        });

        // Track which history entry this note corresponds to
        activeNoteIds.current.set(note, startTime);
      } else {
        // Note off
        setActiveNotes(prev => {
          const next = new Map(prev);
          next.delete(note);
          return next;
        });

        // Update history with end time
        const noteStartTime = activeNoteIds.current.get(note);
        if (noteStartTime) {
          setNoteHistory(prev =>
            prev.map(n =>
              n.note === note && n.startTime === noteStartTime && !n.endTime
                ? { ...n, endTime: Date.now() }
                : n
            )
          );
          activeNoteIds.current.delete(note);
        }
      }
    }

    if (type === 'control' && eventData.controlName === 'sustain') {
      setSustainPedal(eventData.value >= 64);
    }

    if (type === 'session') {
      setSessionInfo(eventData);
      if (eventData.event === 'session_start') {
        // Clear notes on new session
        setActiveNotes(new Map());
        setSustainPedal(false);
        setNoteHistory([]);
        activeNoteIds.current.clear();
      }
    }
  }, [logger]);

  useWebSocketSubscription('midi', handleMidiMessage, [handleMidiMessage]);

  // Stale note cleanup — auto-release notes held longer than STALE_NOTE_MS
  // Handles lost note_off events (WebSocket drops, sustain pedal edge cases)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActiveNotes(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [note, { timestamp }] of prev) {
          if (now - timestamp > STALE_NOTE_MS) {
            next.delete(note);
            changed = true;
            // Set endTime in history for the orphaned note
            const noteStartTime = activeNoteIds.current.get(note);
            if (noteStartTime) {
              setNoteHistory(h =>
                h.map(n =>
                  n.note === note && n.startTime === noteStartTime && !n.endTime
                    ? { ...n, endTime: now }
                    : n
                )
              );
              activeNoteIds.current.delete(note);
            }
          }
        }
        return changed ? next : prev;
      });
    }, 2000); // Check every 2 seconds
    return () => clearInterval(interval);
  }, []);

  // Dev keyboard input (localhost only)
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hostname !== 'localhost') {
      return;
    }

    const pressedKeys = new Set();

    const handleKeyDown = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note || pressedKeys.has(e.key)) return;

      // Prevent other handlers from receiving this key
      e.preventDefault();
      e.stopPropagation();

      pressedKeys.add(e.key);
      const startTime = Date.now();

      setActiveNotes(prev => {
        const next = new Map(prev);
        next.set(note, { velocity: 80, timestamp: startTime });
        return next;
      });

      setNoteHistory(prev => {
        const newNote = { note, velocity: 80, startTime, endTime: null };
        const newHistory = [...prev, newNote];
        if (newHistory.length > MAX_HISTORY_SIZE) {
          const active = newHistory.filter(n => !n.endTime);
          const completed = newHistory.filter(n => n.endTime);
          const trimmed = completed.slice(-(MAX_HISTORY_SIZE - active.length));
          return [...trimmed, ...active];
        }
        return newHistory;
      });

      activeNoteIds.current.set(note, startTime);
    };

    const handleKeyUp = (e) => {
      const note = DEV_KEY_MAP[e.key];
      if (!note) return;

      // Prevent other handlers from receiving this key
      e.preventDefault();
      e.stopPropagation();

      pressedKeys.delete(e.key);

      setActiveNotes(prev => {
        const next = new Map(prev);
        next.delete(note);
        return next;
      });

      const noteStartTime = activeNoteIds.current.get(note);
      if (noteStartTime) {
        setNoteHistory(prev =>
          prev.map(n =>
            n.note === note && n.startTime === noteStartTime && !n.endTime
              ? { ...n, endTime: Date.now() }
              : n
          )
        );
        activeNoteIds.current.delete(note);
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

  return {
    activeNotes,
    sustainPedal,
    sessionInfo,
    isPlaying: activeNotes.size > 0,
    noteHistory
  };
}

export default useMidiSubscription;
