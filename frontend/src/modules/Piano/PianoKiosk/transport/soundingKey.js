import { keyLabel } from '../modes/SheetMusic/keyLabel.js';

// Major-tonic pitch class for a MusicXML fifths value (−7..7); minor uses the
// relative minor (major pc + 9 mod 12, i.e. down a minor third).
const MAJOR_PC = { '-7': 11, '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5, 0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * soundingKeyLabel — the key the listener hears when a score written in
 * `fifths`/`mode` is transposed by `semitones`. 0 defers to keyLabel (which
 * keeps the written spelling); otherwise spell sharps going up, flats going
 * down. Returns null when the written key is unknown.
 */
export function soundingKeyLabel(fifths, mode, semitones) {
  if (!Number.isFinite(fifths) || MAJOR_PC[fifths] === undefined) return null;
  if (!semitones) return keyLabel(fifths, mode);
  const minor = mode === 'minor';
  const basePc = (MAJOR_PC[fifths] + (minor ? 9 : 0)) % 12;
  const pc = ((basePc + semitones) % 12 + 12) % 12;
  const name = (semitones > 0 ? SHARP : FLAT)[pc];
  return `${name} ${minor ? 'minor' : 'major'}`;
}
