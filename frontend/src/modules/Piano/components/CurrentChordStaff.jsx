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
 * Generate ABC notation for a grand staff with current notes
 * Always shows both treble and bass clefs with a closing bar line
 */
const generateAbc = (activeNotes) => {
  const notes = Array.from(activeNotes.keys()).sort((a, b) => a - b);

  // Split at C4 (MIDI 60)
  const trebleNotes = notes.filter(n => n >= 60);
  const bassNotes = notes.filter(n => n < 60);

  // Use 'x' (invisible rest) if no notes on that staff
  const trebleAbc = trebleNotes.length > 0
    ? (trebleNotes.length === 1 ? midiToAbc(trebleNotes[0]) : '[' + trebleNotes.map(midiToAbc).join('') + ']')
    : 'x';

  const bassAbc = bassNotes.length > 0
    ? (bassNotes.length === 1 ? midiToAbc(bassNotes[0]) : '[' + bassNotes.map(midiToAbc).join('') + ']')
    : 'x';

  // Build ABC string - always show both staves with closing bar line
  // Add invisible rests (x) to pad measure width
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
[V:RH] x x ${trebleAbc} x x |]
[V:LH] x x ${bassAbc} x x |]`;

  return abc;
};

/**
 * Live chord display using abcjs
 * Shows currently pressed notes on a grand staff
 */
export function CurrentChordStaff({ activeNotes }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  // Convert Map to a stable string for dependency tracking
  const activeNotesKey = Array.from(activeNotes.keys()).sort((a, b) => a - b).join(',');

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const abc = generateAbc(activeNotes);

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
  }, [activeNotesKey]);

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
