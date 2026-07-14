/**
 * keyLabel — a human key name from a MusicXML key signature (fifths) and mode.
 * A minor piece with no sharps/flats is "A minor", not "C major" (audit L1): the
 * fifths give the signature; the mode picks the major tonic or its relative minor.
 */
const MAJOR = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
const MINOR = { '-7': 'Ab', '-6': 'Eb', '-5': 'Bb', '-4': 'F', '-3': 'C', '-2': 'G', '-1': 'D', 0: 'A', 1: 'E', 2: 'B', 3: 'F#', 4: 'C#', 5: 'G#', 6: 'D#', 7: 'A#' };

/**
 * @param {number} fifths - MusicXML `<fifths>` (−7..7)
 * @param {string} [mode] - 'major' | 'minor' (defaults to major)
 * @returns {string|null} e.g. "A minor", "Bb major", or null if out of range
 */
export function keyLabel(fifths, mode) {
  const table = mode === 'minor' ? MINOR : MAJOR;
  const tonic = table[fifths];
  if (!tonic) return null;
  return `${tonic} ${mode === 'minor' ? 'minor' : 'major'}`;
}

export default { keyLabel };
