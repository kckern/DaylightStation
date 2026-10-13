// keyedChordName — spell a roman-numeral chord token as a CONCRETE chord in a
// given key (design §7). In the Producer a loop is transposed to the jam key,
// so Roman `I` sounds at the session tonic; this turns `Isus4` + tonic D into
// "Dsus4", `vi` into "Bm", `V7` into "A7". Pure, presentation-only — it lives
// beside parseRoman (its parser), not in shared/music.
import { parseRoman } from './parseRoman.js';

// Major-scale semitone for scale degrees 1..7 (the roman reference ruler, same
// as romanAnalysis DEGREES). Accidental shifts by ±1.
const DEGREE_SEMITONE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const NUMERAL_DEGREE = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

// Root pitch-class → name. Flats for the "black keys" read naturally for the
// common borrowed degrees (bIII, bVI, bVII); matches the Producer key label set.
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Quality → the chord-symbol suffix that precedes any figure. */
function baseSuffix(quality) {
  switch (quality) {
    case 'minor': return 'm';
    case 'dim': return '°'; // °
    case 'aug': return '+';
    default: return ''; // major
  }
}

/**
 * @param {string} token  a roman token in the project convention (e.g. 'Isus4',
 *   'vi', 'bVII', 'V7', 'vii°')
 * @param {number} tonicPc  pitch class (0..11) that Roman `I` maps to in this key
 * @returns {string|null} the keyed chord name (e.g. 'Dsus4'), or null if the
 *   token is unparseable / the tonic is not a number
 */
export function keyedChordName(token, tonicPc) {
  if (!Number.isFinite(tonicPc)) return null;
  const { accidental, numeral, quality, figure } = parseRoman(token);
  const degree = NUMERAL_DEGREE[String(numeral).toLowerCase()];
  if (!degree) return null; // '·'/unknown

  const accShift = accidental === '♭' ? -1 : accidental === '♯' ? 1 : 0; // ♭ / ♯
  const rootPc = mod12(tonicPc + DEGREE_SEMITONE[degree] + accShift);
  return `${PC_NAMES[rootPc]}${baseSuffix(quality)}${figure || ''}`;
}

export default keyedChordName;
