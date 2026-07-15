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

// Natural-note pitch classes (letter → pc, no accidental).
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Tonic pitch class (0-11) for each major key, derived once from the key name
// so it stays in sync with KEY_SIGNATURES: base letter + accidentals (# = +1,
// b = -1), mod 12. (F# and Gb are enharmonic → both tonic pc 6; they score
// equally, which is the intended existing behavior.)
const KEY_TONIC = Object.fromEntries(
  Object.keys(KEY_SIGNATURES).map(name => {
    let pc = NATURAL_PC[name[0]];
    for (const acc of name.slice(1)) pc += acc === '#' ? 1 : -1;
    return [name, ((pc % 12) + 12) % 12];
  })
);

// Krumhansl–Kessler major key-profile weights, indexed by scale degree
// (offset from the tonic): index 0 = tonic, 7 = dominant, 11 = leading tone.
// Higher weight = tonally more central, so tonic/dominant emphasis lets
// one-accidental keys (G, F) out-score C instead of collapsing to it.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

// Relative hysteresis margin: a rival key must beat the current key's own
// profile score by this fraction before we switch, so passing notes and
// near-ties don't flicker the displayed key.
const HYSTERESIS = 0.05;

/**
 * Detect the most likely major key from a buffer of recent pitch classes.
 *
 * Scores every major key with the Krumhansl–Kessler major profile: for a key
 * with tonic pitch class `t`, score = Σ counts[pc] * MAJOR_PROFILE[(pc - t) mod 12].
 * This weights tonic/dominant/leading-tone emphasis rather than mere scale
 * membership, so keys that share most of C major's tones (e.g. G, F) can still
 * win. A relative hysteresis margin keeps the current key unless a rival's
 * score beats the current key's score by HYSTERESIS, preventing flicker.
 *
 * If `currentKey` is not a known major key (e.g. a minor/enharmonic/stale
 * value), the margin is skipped and the detected key is adopted outright.
 *
 * @param {number[]} pitchClasses  pitch classes 0-11 (callers pass midi % 12).
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

  for (const keyName of Object.keys(KEY_SIGNATURES)) {
    const tonic = KEY_TONIC[keyName];
    let score = 0;
    for (let pc = 0; pc < 12; pc++) {
      if (counts[pc] > 0) score += counts[pc] * MAJOR_PROFILE[(pc - tonic + 12) % 12];
    }

    if (keyName === currentKey) currentScore = score;
    if (score > bestScore) {
      bestScore = score;
      bestKey = keyName;
    }
  }

  // Only apply the hysteresis margin when the current key is a known major key;
  // an unknown current key has no meaningful score, so adopt the winner.
  const currentKnown = Object.prototype.hasOwnProperty.call(KEY_TONIC, currentKey);
  if (!currentKnown) return bestKey;

  // Switch only if the winner beats the current key's own score by the margin.
  if (bestKey !== currentKey && bestScore > currentScore * (1 + HYSTERESIS)) return bestKey;
  return currentKey;
};
