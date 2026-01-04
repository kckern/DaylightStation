import { useEffect, useRef, useState } from 'react';
import abcjs from 'abcjs';
import 'abcjs/abcjs-audio.css';
import './CurrentChordStaff.scss';

/**
 * Key signature definitions
 * sharps/flats: pitch classes (0-11) that are sharped/flatted in this key
 * scale: the 7 pitch classes that belong to this major scale
 */
const KEY_SIGNATURES = {
  'C':  { sharps: [], flats: [], scale: [0, 2, 4, 5, 7, 9, 11] },
  'G':  { sharps: [6], flats: [], scale: [0, 2, 4, 6, 7, 9, 11] },
  'D':  { sharps: [6, 1], flats: [], scale: [1, 2, 4, 6, 7, 9, 11] },
  'A':  { sharps: [6, 1, 8], flats: [], scale: [1, 2, 4, 6, 8, 9, 11] },
  'E':  { sharps: [6, 1, 8, 3], flats: [], scale: [1, 3, 4, 6, 8, 9, 11] },
  'B':  { sharps: [6, 1, 8, 3, 10], flats: [], scale: [1, 3, 4, 6, 8, 10, 11] },
  'F#': { sharps: [6, 1, 8, 3, 10, 5], flats: [], scale: [1, 3, 5, 6, 8, 10, 11] },
  'F':  { sharps: [], flats: [10], scale: [0, 2, 4, 5, 7, 9, 10] },
  'Bb': { sharps: [], flats: [10, 3], scale: [0, 2, 3, 5, 7, 9, 10] },
  'Eb': { sharps: [], flats: [10, 3, 8], scale: [0, 2, 3, 5, 7, 8, 10] },
  'Ab': { sharps: [], flats: [10, 3, 8, 1], scale: [0, 1, 3, 5, 7, 8, 10] },
  'Db': { sharps: [], flats: [10, 3, 8, 1, 6], scale: [0, 1, 3, 5, 6, 8, 10] },
  'Gb': { sharps: [], flats: [10, 3, 8, 1, 6, 11], scale: [0, 1, 3, 5, 6, 8, 10] }
};

// Natural note names (white keys)
const NATURAL_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Pitch class to natural note mapping (for determining base note)
const PITCH_TO_NATURAL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C, C#->C, D, D#->D, E, F, F#->F, G, G#->G, A, A#->A, B

/**
 * Detect the most likely key from a buffer of recent pitch classes
 * Returns the key name (e.g., 'G', 'F', 'C')
 */
const detectKey = (pitchClasses, currentKey = 'C') => {
  if (pitchClasses.length < 5) return currentKey;

  // Count unique pitch classes
  const uniquePitches = new Set(pitchClasses);
  if (uniquePitches.size < 3) return currentKey;

  // Count occurrences of each pitch class
  const counts = new Array(12).fill(0);
  pitchClasses.forEach(pc => counts[pc]++);

  // Score each key by how many notes fit its scale
  let bestKey = currentKey;
  let bestScore = 0;
  let currentScore = 0;

  for (const [keyName, keyData] of Object.entries(KEY_SIGNATURES)) {
    const scaleSet = new Set(keyData.scale);
    let score = 0;
    let total = 0;

    for (let pc = 0; pc < 12; pc++) {
      if (counts[pc] > 0) {
        total += counts[pc];
        if (scaleSet.has(pc)) {
          score += counts[pc];
        }
      }
    }

    const percentage = total > 0 ? score / total : 0;

    if (keyName === currentKey) {
      currentScore = percentage;
    }

    if (percentage > bestScore) {
      bestScore = percentage;
      bestKey = keyName;
    }
  }

  // Hysteresis: only switch if new key is significantly better (20% threshold)
  if (bestKey !== currentKey && bestScore > currentScore + 0.2) {
    return bestKey;
  }

  return currentKey;
};

/**
 * Convert MIDI note number to ABC notation with key signature awareness
 * C4 (MIDI 60) = 'C' in ABC
 */
const midiToAbc = (midiNote, keySignature = null) => {
  const pitchClass = midiNote % 12;
  const octave = Math.floor(midiNote / 12) - 1;

  // Get key data (default to C major if not specified)
  const keyData = keySignature ? KEY_SIGNATURES[keySignature] : KEY_SIGNATURES['C'];
  const sharps = new Set(keyData?.sharps || []);
  const flats = new Set(keyData?.flats || []);
  const scale = new Set(keyData?.scale || [0, 2, 4, 5, 7, 9, 11]);

  // Determine the note name and any needed accidental
  let noteName;
  let accidental = '';

  // Check if this pitch class is in the key's scale
  const isInScale = scale.has(pitchClass);

  if (isInScale) {
    // Note is in key - use the appropriate spelling
    if (sharps.has(pitchClass)) {
      // This is a sharped note in the key (e.g., F# in G major)
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];
      // No accidental needed - key signature handles it
    } else if (flats.has(pitchClass)) {
      // This is a flatted note in the key (e.g., Bb in F major)
      const naturalIndex = (PITCH_TO_NATURAL[pitchClass] + 1) % 7;
      noteName = NATURAL_NOTES[naturalIndex];
      // No accidental needed - key signature handles it
    } else {
      // Natural note in the key
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];
    }
  } else {
    // Note is NOT in the key - need explicit accidental
    // Check if it's a chromatic alteration
    const isSharp = [1, 3, 6, 8, 10].includes(pitchClass); // C#, D#, F#, G#, A#

    if (isSharp) {
      // Check if the natural version is sharped in the key
      const naturalPc = pitchClass - 1;
      if (sharps.has(naturalPc)) {
        // The natural is already sharped, so we need double sharp - just use sharp notation
        const naturalIndex = PITCH_TO_NATURAL[pitchClass];
        noteName = NATURAL_NOTES[naturalIndex];
        accidental = '^';
      } else {
        // Add sharp
        const naturalIndex = PITCH_TO_NATURAL[pitchClass];
        noteName = NATURAL_NOTES[naturalIndex];
        accidental = '^';
      }
    } else {
      // Natural pitch class that's not in scale - might need a natural sign
      const naturalIndex = PITCH_TO_NATURAL[pitchClass];
      noteName = NATURAL_NOTES[naturalIndex];

      // Check if this natural note is normally sharped or flatted in the key
      if (sharps.has(pitchClass) || flats.has(pitchClass)) {
        // Key expects an alteration, but we want natural
        accidental = '=';
      } else if (sharps.has(pitchClass + 1)) {
        // The note above is sharped (e.g., F is natural but F# is in key)
        // This means we're playing F natural when F# is expected - need natural sign
        // Actually, check if current pitch needs natural
        for (const sharpPc of sharps) {
          if (sharpPc - 1 === pitchClass) {
            // e.g., F# in key, playing F natural
            accidental = '=';
            break;
          }
        }
      }
    }
  }

  // Build the ABC notation with octave handling
  let abc = accidental + noteName;

  if (octave >= 5) {
    abc = accidental + noteName.toLowerCase();
    abc += "'".repeat(octave - 5);
  } else if (octave === 4) {
    abc = accidental + noteName;
  } else {
    abc = accidental + noteName + ",".repeat(4 - octave);
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
 * Smart staff split - infer which hand is playing which notes
 * Returns { bassNotes: number[], trebleNotes: number[] }
 *
 * Algorithm:
 * 1. Single note: treble if >= C4 (60), else bass
 * 2. Two notes forming octave (12) or fifth (7): both go to bass
 * 3. 3+ notes: detect bass pattern (octave/fifth in lowest notes), rest is treble
 * 4. If no bass pattern: use largest gap as split, or all to one staff if clustered
 */
const splitByHand = (notes) => {
  if (notes.length === 0) return { bassNotes: [], trebleNotes: [] };

  // Single note: simple split at C4
  if (notes.length === 1) {
    return notes[0] >= 60
      ? { bassNotes: [], trebleNotes: notes }
      : { bassNotes: notes, trebleNotes: [] };
  }

  // Two notes: check for bass pattern (octave or fifth)
  if (notes.length === 2) {
    const interval = notes[1] - notes[0];
    // Octave (12) or fifth (7) = bass pattern, both go to bass
    if (interval === 12 || interval === 7) {
      return { bassNotes: notes, trebleNotes: [] };
    }
    // Otherwise, if both are high, all treble; if both low, all bass; else split at C4
    if (notes[0] >= 60) return { bassNotes: [], trebleNotes: notes };
    if (notes[1] < 60) return { bassNotes: notes, trebleNotes: [] };
    return { bassNotes: [notes[0]], trebleNotes: [notes[1]] };
  }

  // 3+ notes: check for bass pattern in lowest 1-2 notes
  const lowest = notes[0];
  const secondLowest = notes[1];
  const interval = secondLowest - lowest;

  // Check if lowest two notes form a bass pattern (octave or fifth)
  if (interval === 12 || interval === 7) {
    // Bass pattern detected - lowest two are left hand
    return {
      bassNotes: [lowest, secondLowest],
      trebleNotes: notes.slice(2)
    };
  }

  // Check if just the lowest note is isolated (gap to next note)
  // Find the largest gap between adjacent notes
  let maxGap = 0;
  let maxGapIndex = 0;
  for (let i = 0; i < notes.length - 1; i++) {
    const gap = notes[i + 1] - notes[i];
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIndex = i;
    }
  }

  // If there's a significant gap (> 4 semitones, roughly a major third), split there
  if (maxGap > 4) {
    return {
      bassNotes: notes.slice(0, maxGapIndex + 1),
      trebleNotes: notes.slice(maxGapIndex + 1)
    };
  }

  // No clear split - all notes are clustered together
  // Put them all on one staff based on average position
  const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
  if (avg >= 60) {
    return { bassNotes: [], trebleNotes: notes };
  } else {
    return { bassNotes: notes, trebleNotes: [] };
  }
};

/**
 * Generate ABC notation for a grand staff with current notes
 * Always shows both treble and bass clefs with a closing bar line
 * Uses 8va/8vb/15ma/15mb for extreme high/low notes to avoid excessive ledger lines
 * @param {Map} activeNotes - Map of MIDI note numbers to note data
 * @param {string} keySignature - Key signature to use (e.g., 'G', 'F', 'C')
 */
const generateAbc = (activeNotes, keySignature = 'C') => {
  const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);

  // Smart split based on hand inference
  const { bassNotes, trebleNotes } = splitByHand(notes);

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
    ? (displayTrebleNotes.length === 1
        ? midiToAbc(displayTrebleNotes[0], keySignature)
        : '[' + displayTrebleNotes.map(n => midiToAbc(n, keySignature)).join('') + ']')
    : 'x';

  const bassAbc = displayBassNotes.length > 0
    ? (displayBassNotes.length === 1
        ? midiToAbc(displayBassNotes[0], keySignature)
        : '[' + displayBassNotes.map(n => midiToAbc(n, keySignature)).join('') + ']')
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
K:${keySignature}
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
const KEY_BUFFER_MAX_AGE = 10000; // 10 seconds
const KEY_BUFFER_MAX_NOTES = 30; // Keep last 30 notes

/**
 * Live chord display using abcjs
 * Shows currently pressed notes on a grand staff
 * Notes persist for 500ms after release unless new notes arrive
 * Multiple notes are treated as a group - the full chord persists during decay
 * Automatically detects key signature from recent notes
 */
export function CurrentChordStaff({ activeNotes }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
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

      // Add new notes to the key detection buffer
      const now = Date.now();
      const newNotes = [...currentKeys].filter(key => !lastKeys.has(key));
      newNotes.forEach(note => {
        noteBufferRef.current.push({
          pitchClass: note % 12,
          timestamp: now
        });
      });

      // Prune old notes from buffer
      noteBufferRef.current = noteBufferRef.current
        .filter(n => now - n.timestamp < KEY_BUFFER_MAX_AGE)
        .slice(-KEY_BUFFER_MAX_NOTES);

      // Detect key from buffer
      const pitchClasses = noteBufferRef.current.map(n => n.pitchClass);
      const newKey = detectKey(pitchClasses, detectedKey);
      if (newKey !== detectedKey) {
        setDetectedKey(newKey);
      }
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
  }, [activeNotes, detectedKey]);

  // Convert Map to a stable string for dependency tracking
  const displayNotesKey = Array.from(displayNotes.keys()).sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const abc = generateAbc(displayNotes, detectedKey);

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
  }, [displayNotesKey, detectedKey]);

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
