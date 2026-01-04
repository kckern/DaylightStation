import { useEffect, useRef, useState } from 'react';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';
import './CurrentChordStaff.scss';

/**
 * Convert MIDI note number to ABC notation
 * C4 (MIDI 60) = 'C' in ABC
 */
const midiToAbc = (midiNote) => {
  const noteNames = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
  const noteName = noteNames[midiNote % 12];
  const octave = Math.floor(midiNote / 12) - 1; // MIDI octave (C4 = octave 4)

  // ABC notation:
  // Octave 4: C D E F G A B (uppercase)
  // Octave 5: c d e f g a b (lowercase)
  // Octave 3: C, D, E, (comma suffix)
  // Octave 6: c' d' e' (apostrophe suffix)

  let abc = noteName;

  if (octave >= 5) {
    // Lowercase for octave 5+
    abc = noteName.toLowerCase();
    // Add apostrophes for octaves above 5
    abc += "'".repeat(octave - 5);
  } else if (octave === 4) {
    // Uppercase, no modifier
    abc = noteName;
  } else {
    // Add commas for octaves below 4
    abc = noteName + ",".repeat(4 - octave);
  }

  return abc;
};

/**
 * Calculate how many octaves to transpose for display
 * Returns { octaves: number, marker: string } for the ottava marking
 * Treble: notes above A6 (MIDI 93) need 8va, above A7 (105) need 15ma, etc.
 * Bass: notes below E2 (MIDI 40) need 8vb, below E1 (28) need 15mb, etc.
 */
const getOttavaInfo = (notes, isHighRange) => {
  if (notes.length === 0) return { octaves: 0, marker: '' };

  if (isHighRange) {
    // Treble clef - check highest note
    const highest = Math.max(...notes);
    if (highest > 105) return { octaves: 2, marker: '15ma' }; // 2 octaves down for display
    if (highest > 93) return { octaves: 1, marker: '8va' };   // 1 octave down for display
    return { octaves: 0, marker: '' };
  } else {
    // Bass clef - check lowest note
    const lowest = Math.min(...notes);
    if (lowest < 28) return { octaves: 2, marker: '15mb' };   // 2 octaves up for display
    if (lowest < 40) return { octaves: 1, marker: '8vb' };    // 1 octave up for display
    return { octaves: 0, marker: '' };
  }
};

/**
 * Generate ABC notation for a grand staff with current notes
 * Always shows both treble and bass clefs with a closing bar line
 * Uses 8va/8vb/15ma/15mb for extreme high/low notes to avoid excessive ledger lines
 */
const generateAbc = (activeNotes) => {
  const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);

  // Split at C4 (MIDI 60)
  const trebleNotes = notes.filter(n => n >= 60);
  const bassNotes = notes.filter(n => n < 60);

  // Calculate ottava transpositions needed
  const trebleOttava = getOttavaInfo(trebleNotes, true);
  const bassOttava = getOttavaInfo(bassNotes, false);

  // Transpose notes for display based on ottava
  const displayTrebleNotes = trebleOttava.octaves > 0
    ? trebleNotes.map(n => n - (trebleOttava.octaves * 12))
    : trebleNotes;
  const displayBassNotes = bassOttava.octaves > 0
    ? bassNotes.map(n => n + (bassOttava.octaves * 12))
    : bassNotes;

  // Use 'x' (invisible rest) if no notes on that staff
  const trebleAbc = displayTrebleNotes.length > 0
    ? (displayTrebleNotes.length === 1 ? midiToAbc(displayTrebleNotes[0]) : '[' + displayTrebleNotes.map(midiToAbc).join('') + ']')
    : 'x';

  const bassAbc = displayBassNotes.length > 0
    ? (displayBassNotes.length === 1 ? midiToAbc(displayBassNotes[0]) : '[' + displayBassNotes.map(midiToAbc).join('') + ']')
    : 'x';

  // Build ABC string with ottava markings if needed
  const trebleContent = trebleOttava.marker
    ? `!${trebleOttava.marker}(!${trebleAbc}!${trebleOttava.marker})!`
    : trebleAbc;
  const bassContent = bassOttava.marker
    ? `!${bassOttava.marker}(!${bassAbc}!${bassOttava.marker})!`
    : bassAbc;

  const abc = `X:1
L:1/4
M:none
%%topspace 0
%%composerspace 0
%%titlespace 0
%%musicspace 0
%%vocalspace 0
%%textspace 0
%%staffsep 60
%%sysstaffsep 40
%%staves {(RH) (LH)}
V:RH clef=treble
V:LH clef=bass
[V:RH] x x ${trebleContent} x x |]
[V:LH] x x ${bassContent} x x |]`;

  return abc;
};

const NOTE_DECAY_MS = 500; // Keep notes visible for 500ms after release

/**
 * Live chord display using abcjs
 * Shows currently pressed notes on a grand staff
 * Notes persist for 500ms after release unless new notes arrive
 * Multiple notes are treated as a group - the full chord persists during decay
 */
export function CurrentChordStaff({ activeNotes }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [displayNotes, setDisplayNotes] = useState(new Map());
  const decayTimerRef = useRef(null);
  const lastActiveNotesRef = useRef(new Map());
  const peakChordRef = useRef(new Map()); // Track the peak chord (most notes held together)

  // Track changes in active notes and manage decay
  useEffect(() => {
    const currentKeys = new Set(activeNotes.keys());
    const lastKeys = new Set(lastActiveNotesRef.current.keys());

    // Check if new notes were added
    const hasNewNotes = [...currentKeys].some(key => !lastKeys.has(key));

    if (hasNewNotes) {
      // New notes arrived - clear decay timer, reset peak chord, show current notes
      if (decayTimerRef.current) {
        clearTimeout(decayTimerRef.current);
        decayTimerRef.current = null;
      }
      // Start a new peak chord with current notes
      peakChordRef.current = new Map(activeNotes);
      setDisplayNotes(new Map(activeNotes));
    } else if (currentKeys.size > 0) {
      // Notes still active but no new notes - update peak chord if current is larger
      if (currentKeys.size >= peakChordRef.current.size) {
        peakChordRef.current = new Map(activeNotes);
      }
      // Always show the peak chord while any notes are held
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
      if (decayTimerRef.current) {
        clearTimeout(decayTimerRef.current);
      }
    };
  }, [activeNotes]);

  // Convert Map to a stable string for dependency tracking
  const displayNotesKey = Array.from(displayNotes.keys()).sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const abc = generateAbc(displayNotes);

      // Get container dimensions to set staffwidth dynamically
      const containerWidth = containerRef.current.parentElement?.offsetWidth || 600;

      abcjs.renderAbc(containerRef.current, abc, {
        staffwidth: containerWidth - 100,
        paddingtop: 0,
        paddingbottom: 0,
        paddingleft: 50,
        paddingright: 50,
        add_classes: true,
        scale: 1.5
      });
    } catch (e) {
      console.error('abcjs render error:', e.message);
      setError(e.message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNotesKey]);

  if (error) {
    return <span style={{ color: 'red', fontSize: '12px' }}>{error}</span>;
  }

  return (
    <div className="current-chord-staff-wrapper">
      <div className="current-chord-staff" ref={containerRef} />
    </div>
  );
}

export default CurrentChordStaff;
