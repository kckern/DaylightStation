// Shared note positioning utilities for waterfall and game mode
// Extracted from NoteWaterfall.jsx to avoid duplication

// White keys in an octave (C, D, E, F, G, A, B)
export const WHITE_KEY_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const isWhiteKey = (note) => WHITE_KEY_NOTES.includes(note % 12);

/**
 * Calculate horizontal position (%) for a MIDI note on the keyboard
 * White keys are centered on their key; black keys align with the left edge of the next white key
 */
export const getNotePosition = (note, startNote = 21, endNote = 108) => {
  let whiteKeysBefore = 0;
  let totalWhiteKeys = 0;

  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) {
      totalWhiteKeys++;
      if (n < note) whiteKeysBefore++;
    }
  }

  const keyWidth = 100 / totalWhiteKeys;

  if (isWhiteKey(note)) {
    return whiteKeysBefore * keyWidth + keyWidth / 2;
  } else {
    return whiteKeysBefore * keyWidth;
  }
};

/**
 * Calculate width (%) for a note bar
 * White keys: 90% of key width, black keys: 50%
 */
export const getNoteWidth = (note, startNote = 21, endNote = 108) => {
  let totalWhiteKeys = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) totalWhiteKeys++;
  }
  const keyWidth = 100 / totalWhiteKeys;
  return isWhiteKey(note) ? keyWidth * 0.9 : keyWidth * 0.5;
};

/**
 * Color hue (0-280) based on pitch. Low=red, mid=cyan, high=purple
 */
export const getNoteHue = (note, startNote = 21, endNote = 108) => {
  const range = endNote - startNote;
  const position = (note - startNote) / range;
  return Math.round(position * 280);
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Get the note name (e.g. "C4", "F#5") for a MIDI note number
 */
export const getNoteName = (note) => {
  const name = NOTE_NAMES[note % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
};
