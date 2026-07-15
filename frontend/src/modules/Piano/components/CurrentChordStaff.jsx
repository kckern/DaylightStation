import { useEffect, useRef, useState } from 'react';
import { ChordStaffRenderer } from '../../MusicNotation/renderers/ChordStaffRenderer.jsx';
import { useDetectedKey } from './useDetectedKey.js';
import './CurrentChordStaff.scss';

// Music-theory model (key signatures, key detection, hand split) lives in the
// shared MusicNotation framework. CurrentChordStaff keeps the live-input concerns
// — note decay, peak-chord tracking — and delegates key detection to the shared
// useDetectedKey hook and rendering to ChordStaffRenderer (a compact,
// self-centering VexFlow grand staff).

const NOTE_DECAY_MS = 500; // Keep notes visible for 500ms after release

/**
 * Live chord display using the shared abcjs renderer.
 * Shows currently pressed notes on a grand staff. Notes persist for 500ms after
 * release unless new notes arrive; the full peak chord persists during decay.
 *
 * Key signature: when a `detectedKey` prop is supplied (TheoryPanel passes the
 * shared key so the circle + staff agree), it wins. Otherwise the component
 * falls back to its own rolling detection via useDetectedKey — preserving the
 * standalone behavior.
 *
 * @param {Map} activeNotes - live MIDI surface (Map<midi, data>)
 * @param {string} [detectedKey] - externally-owned key; overrides internal detection
 */
export function CurrentChordStaff({ activeNotes, detectedKey }) {
  const [displayNotes, setDisplayNotes] = useState(new Map());
  const decayTimerRef = useRef(null);
  const lastActiveNotesRef = useRef(new Map());
  const peakChordRef = useRef(new Map()); // Track the peak chord (most notes held together)

  // Always run the hook (Rules of Hooks); the prop takes precedence when present.
  const internalKey = useDetectedKey(activeNotes);
  const keySig = detectedKey ?? internalKey;

  // Track changes in active notes and manage note decay + peak chord.
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
  }, [activeNotes]);

  return (
    <div className="current-chord-staff-wrapper">
      <ChordStaffRenderer notes={displayNotes} keySignature={keySig} className="chord-staff current-chord-staff" />
    </div>
  );
}

export default CurrentChordStaff;
