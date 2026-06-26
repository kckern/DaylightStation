import { useEffect, useRef, useState } from 'react';
import { detectKey } from '../../MusicNotation/model/keySignature.js';
import { AbcRenderer } from '../../MusicNotation/renderers/AbcRenderer.jsx';
import './CurrentChordStaff.scss';

// Music-theory model (key signatures, key detection, hand split, ABC generation)
// now lives in the shared MusicNotation framework. CurrentChordStaff keeps the
// live-input concerns — note decay, peak-chord tracking, rolling key detection —
// and delegates rendering to AbcRenderer.

const NOTE_DECAY_MS = 500; // Keep notes visible for 500ms after release
const KEY_BUFFER_MAX_AGE = 10000; // 10 seconds
const KEY_BUFFER_MAX_NOTES = 30; // Keep last 30 notes

/**
 * Live chord display using the shared abcjs renderer.
 * Shows currently pressed notes on a grand staff. Notes persist for 500ms after
 * release unless new notes arrive; the full peak chord persists during decay.
 * Automatically detects the key signature from recent notes.
 */
export function CurrentChordStaff({ activeNotes }) {
  const [displayNotes, setDisplayNotes] = useState(new Map());
  const [detectedKey, setDetectedKey] = useState('C');
  const decayTimerRef = useRef(null);
  const lastActiveNotesRef = useRef(new Map());
  const peakChordRef = useRef(new Map()); // Track the peak chord (most notes held together)
  const noteBufferRef = useRef([]); // Rolling buffer of { pitchClass, timestamp }

  // Track changes in active notes and manage decay
  useEffect(() => {
    const currentKeys = new Set(activeNotes.keys());
    const lastKeys = new Set(lastActiveNotesRef.current.keys());

    const hasNewNotes = [...currentKeys].some(key => !lastKeys.has(key));

    if (hasNewNotes) {
      // New notes arrived - clear decay timer, reset peak chord, show current notes
      if (decayTimerRef.current) {
        clearTimeout(decayTimerRef.current);
        decayTimerRef.current = null;
      }
      peakChordRef.current = new Map(activeNotes);
      setDisplayNotes(new Map(activeNotes));

      const now = Date.now();
      const newNotes = [...currentKeys].filter(key => !lastKeys.has(key));
      newNotes.forEach(note => {
        noteBufferRef.current.push({ pitchClass: note % 12, timestamp: now });
      });

      noteBufferRef.current = noteBufferRef.current
        .filter(n => now - n.timestamp < KEY_BUFFER_MAX_AGE)
        .slice(-KEY_BUFFER_MAX_NOTES);

      const pitchClasses = noteBufferRef.current.map(n => n.pitchClass);
      const newKey = detectKey(pitchClasses, detectedKey);
      if (newKey !== detectedKey) setDetectedKey(newKey);
    } else if (currentKeys.size > 0) {
      // Notes still active but no new notes - update peak chord if current is larger
      if (currentKeys.size >= peakChordRef.current.size) {
        peakChordRef.current = new Map(activeNotes);
      }
      setDisplayNotes(new Map(peakChordRef.current));
    } else if (currentKeys.size === 0 && lastKeys.size > 0) {
      // All notes released - show peak chord and start decay timer
      setDisplayNotes(new Map(peakChordRef.current));
      decayTimerRef.current = setTimeout(() => {
        setDisplayNotes(new Map());
        peakChordRef.current = new Map();
      }, NOTE_DECAY_MS);
    }

    lastActiveNotesRef.current = new Map(activeNotes);

    return () => {
      if (decayTimerRef.current) clearTimeout(decayTimerRef.current);
    };
  }, [activeNotes, detectedKey]);

  return (
    <div className="current-chord-staff-wrapper">
      <AbcRenderer notes={displayNotes} keySignature={detectedKey} className="current-chord-staff" pinStaff />
    </div>
  );
}

export default CurrentChordStaff;
