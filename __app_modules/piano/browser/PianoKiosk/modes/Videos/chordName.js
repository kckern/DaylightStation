// chordName.js
import { getNoteName } from '../../../noteUtils.js';

const PC_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// interval set (semitones above root, sorted, joined) → quality label
const TRIAD_QUALITY = { '0,4,7': 'major', '0,3,7': 'minor', '0,3,6': 'dim', '0,4,8': 'aug' };
const SEVENTH_QUALITY = { '0,4,7,10': '7', '0,4,7,11': 'maj7', '0,3,7,10': 'm7', '0,3,6,10': 'm7b5', '0,3,6,9': 'dim7' };

/**
 * Describe the notes currently held.
 * @param {Iterable<number>} midiNotes
 * @returns {{ notes: string[], name: string|null }} notes low→high with octave;
 *   name = chord name if a known triad/seventh in any inversion, else null.
 */
export function describeChord(midiNotes) {
  const arr = Array.from(midiNotes || []).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const notes = arr.map((n) => getNoteName(n));
  const pcs = Array.from(new Set(arr.map((n) => ((n % 12) + 12) % 12)));
  let name = null;
  if (pcs.length === 3 || pcs.length === 4) {
    for (const root of pcs) {
      const intervals = pcs.map((pc) => (((pc - root) % 12) + 12) % 12).sort((a, b) => a - b).join(',');
      const quality = pcs.length === 3 ? TRIAD_QUALITY[intervals] : SEVENTH_QUALITY[intervals];
      if (quality) {
        const r = PC_NAMES_SHARP[root];
        name = quality === 'major' ? `${r} major`
          : quality === 'minor' ? `${r} minor`
          : quality === 'dim' ? `${r} dim`
          : quality === 'aug' ? `${r} aug`
          : `${r}${quality}`;
        break;
      }
    }
  }
  return { notes, name };
}
