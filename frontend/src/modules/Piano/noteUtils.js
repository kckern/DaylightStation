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
 * In compact mode (game): narrower so black/white columns don't overlap
 */
export const getNoteWidth = (note, startNote = 21, endNote = 108, compact = false) => {
  let totalWhiteKeys = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (isWhiteKey(n)) totalWhiteKeys++;
  }
  const keyWidth = 100 / totalWhiteKeys;
  if (compact) {
    return isWhiteKey(note) ? keyWidth * 0.6 : keyWidth * 0.35;
  }
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

/**
 * Fisher-Yates shuffle (in-place). Returns the array.
 * @param {any[]} arr
 * @returns {any[]}
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Build an array of MIDI notes within [low, high] inclusive,
 * optionally filtered to white keys only.
 *
 * @param {[number, number]} noteRange - [low, high] inclusive
 * @param {boolean} whiteKeysOnly
 * @returns {number[]}
 */
export function buildNotePool(noteRange, whiteKeysOnly = false) {
  const [low, high] = noteRange;
  const pool = [];
  for (let n = low; n <= high; n++) {
    if (whiteKeysOnly && !isWhiteKey(n)) continue;
    pool.push(n);
  }
  return pool;
}

/**
 * Compute display range for a piano keyboard given a game's note range.
 * Pads by ~1/3 of the span on each side, ensures minimum 2-octave display,
 * and clamps to the full piano range [21, 108].
 *
 * @param {[number, number]|null} noteRange - [low, high] or null for full range
 * @returns {{ startNote: number, endNote: number }}
 */
export function computeKeyboardRange(noteRange) {
  if (!noteRange) return { startNote: 21, endNote: 108 };

  const [low, high] = noteRange;
  const span = high - low;
  const padding = Math.max(4, Math.round(span / 3));
  const minSpan = 24;

  let displayStart = low - padding;
  let displayEnd = high + padding;
  const displaySpan = displayEnd - displayStart;

  if (displaySpan < minSpan) {
    const extra = minSpan - displaySpan;
    displayStart -= Math.floor(extra / 2);
    displayEnd += Math.ceil(extra / 2);
  }

  return {
    startNote: Math.max(21, displayStart),
    endNote: Math.min(108, displayEnd),
  };
}
