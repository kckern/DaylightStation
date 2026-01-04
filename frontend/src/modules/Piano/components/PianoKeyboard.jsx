import React, { useMemo } from 'react';
import './PianoKeyboard.scss';

// White keys in an octave (C, D, E, F, G, A, B)
const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const getNoteLabel = (note) => {
  const octave = Math.floor(note / 12) - 1;
  const name = NOTE_NAMES[note % 12];
  return `${name}${octave}`;
};

/**
 * Visual piano keyboard component
 *
 * @param {Object} props
 * @param {Map<number, { velocity: number }>} props.activeNotes - Currently pressed notes
 * @param {number} props.startNote - First note to display (default: 21 = A0)
 * @param {number} props.endNote - Last note to display (default: 108 = C8)
 * @param {boolean} props.showLabels - Show note labels on white keys
 */
export function PianoKeyboard({
  activeNotes = new Map(),
  startNote = 21,
  endNote = 108,
  showLabels = false
}) {
  const keys = useMemo(() => {
    const result = [];

    for (let note = startNote; note <= endNote; note++) {
      const isActive = activeNotes.has(note);
      const noteData = activeNotes.get(note);
      const velocity = noteData?.velocity || 0;
      const isWhite = isWhiteKey(note);

      result.push(
        <div
          key={note}
          className={`piano-key ${isWhite ? 'white' : 'black'} ${isActive ? 'active' : ''}`}
          style={{ '--velocity': velocity / 127 }}
          data-note={note}
          data-label={getNoteLabel(note)}
        >
          {showLabels && isWhite && note % 12 === 0 && (
            <span className="note-label">{getNoteLabel(note)}</span>
          )}
        </div>
      );
    }

    return result;
  }, [activeNotes, startNote, endNote, showLabels]);

  // Count white keys for sizing
  const whiteKeyCount = useMemo(() => {
    let count = 0;
    for (let note = startNote; note <= endNote; note++) {
      if (isWhiteKey(note)) count++;
    }
    return count;
  }, [startNote, endNote]);

  return (
    <div
      className="piano-keyboard"
      style={{ '--white-key-count': whiteKeyCount }}
    >
      {keys}
    </div>
  );
}

export default PianoKeyboard;
