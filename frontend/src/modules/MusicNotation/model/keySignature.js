// MusicNotation model — key signatures & key detection.
//
// Extracted verbatim (behavior-preserving) from
// modules/Piano/components/CurrentChordStaff.jsx so the music-theory model lives
// in one place, independent of the abcjs renderer that currently consumes it.

/**
 * Key signature definitions.
 * sharps/flats: pitch classes (0-11) that are sharped/flatted in this key.
 * scale: the 7 pitch classes that belong to this major scale.
 */
export const KEY_SIGNATURES = {
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

// Natural note names (white keys).
export const NATURAL_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Pitch class → natural note index (C C#→C D D#→D E F F#→F G G#→G A A#→A B).
export const PITCH_TO_NATURAL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

/**
 * Detect the most likely major key from a buffer of recent pitch classes.
 * Uses hysteresis (20% threshold) so the key doesn't flicker.
 *
 * @param {number[]} pitchClasses
 * @param {string} [currentKey]
 * @returns {string} key name (e.g. 'G', 'F', 'C')
 */
export const detectKey = (pitchClasses, currentKey = 'C') => {
  if (pitchClasses.length < 5) return currentKey;

  const uniquePitches = new Set(pitchClasses);
  if (uniquePitches.size < 3) return currentKey;

  const counts = new Array(12).fill(0);
  pitchClasses.forEach(pc => counts[pc]++);

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
        if (scaleSet.has(pc)) score += counts[pc];
      }
    }

    const percentage = total > 0 ? score / total : 0;
    if (keyName === currentKey) currentScore = percentage;
    if (percentage > bestScore) {
      bestScore = percentage;
      bestKey = keyName;
    }
  }

  if (bestKey !== currentKey && bestScore > currentScore + 0.2) return bestKey;
  return currentKey;
};
