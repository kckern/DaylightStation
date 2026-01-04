import { useMemo } from 'react';
import './NoteWaterfall.scss';

// White keys in an octave (C, D, E, F, G, A, B)
const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

// Calculate x position for a note (percentage)
const getNotePosition = (note, startNote = 21, endNote = 108) => {
  // Count white keys up to this note
  let whiteKeysBefore = 0;
  let totalWhiteKeys = 0;

  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) {
      totalWhiteKeys++;
      if (n < note) whiteKeysBefore++;
    }
  }

  const isWhite = isWhiteKey(note);
  const keyWidth = 100 / totalWhiteKeys;

  if (isWhite) {
    return whiteKeysBefore * keyWidth + keyWidth / 2;
  } else {
    // Black keys are offset from the previous white key
    return whiteKeysBefore * keyWidth + keyWidth * 0.75;
  }
};

const getNoteWidth = (note, startNote = 21, endNote = 108) => {
  let totalWhiteKeys = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) totalWhiteKeys++;
  }
  const keyWidth = 100 / totalWhiteKeys;
  return isWhiteKey(note) ? keyWidth * 0.9 : keyWidth * 0.5;
};

/**
 * Waterfall display showing notes falling down toward the keyboard
 */
export function NoteWaterfall({ noteHistory = [], startNote = 21, endNote = 108 }) {
  const visibleNotes = useMemo(() => {
    const now = Date.now();
    const displayDuration = 5000; // Show notes for 5 seconds

    return noteHistory
      .filter(note => {
        const age = now - note.startTime;
        const endAge = note.endTime ? now - note.endTime : 0;
        // Show if started within display duration or still active
        return age < displayDuration && (!note.endTime || endAge < 1000);
      })
      .map(note => {
        const age = now - note.startTime;
        const duration = note.endTime
          ? note.endTime - note.startTime
          : now - note.startTime;

        return {
          ...note,
          x: getNotePosition(note.note, startNote, endNote),
          width: getNoteWidth(note.note, startNote, endNote),
          age,
          duration,
          isActive: !note.endTime
        };
      });
  }, [noteHistory, startNote, endNote]);

  return (
    <div className="note-waterfall">
      {visibleNotes.map((note, idx) => {
        const heightPercent = Math.min(100, (note.duration / 50)); // Scale duration to height
        const bottomPercent = 100 - (note.age / 50); // Position based on age

        return (
          <div
            key={`${note.note}-${note.startTime}-${idx}`}
            className={`waterfall-note ${note.isActive ? 'active' : ''} ${isWhiteKey(note.note) ? 'white' : 'black'}`}
            style={{
              '--x': `${note.x}%`,
              '--width': `${note.width}%`,
              '--height': `${heightPercent}%`,
              '--bottom': `${bottomPercent}%`,
              '--velocity': note.velocity / 127,
              '--hue': isWhiteKey(note.note) ? 200 : 280
            }}
          />
        );
      })}
    </div>
  );
}

export default NoteWaterfall;
