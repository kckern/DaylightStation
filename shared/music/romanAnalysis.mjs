// Roman-numeral analysis — turns a chord progression into a key-agnostic
// signature. Pure, no DOM. Used by BOTH the loop matcher (find "the same
// progression" across keys/sources) and the circle-of-fifths teaching UX.
//
// Naming uses the major scale as the reference ruler (so chromatic degrees read
// bIII, bVII, #IV); chord quality sets the case/suffix. This is deliberately
// mode-neutral: feed it whatever tonic you're analysing against.

import { parseChordSymbol } from './chords.mjs';
import { mod12 } from './transpose.mjs';

// Semitones above tonic → roman degree (major-scale reference).
const DEGREES = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

/** Roman degree name for a semitone offset (0..11) above the tonic. */
export function degreeNumeral(semitones) {
  return DEGREES[mod12(semitones)];
}

/** Apply chord-quality casing/suffix to a degree numeral. */
function styleByQuality(numeral, quality) {
  switch (quality) {
    case 'minor': return numeral.toLowerCase();
    case 'diminished': return `${numeral.toLowerCase()}°`;
    case 'augmented': return `${numeral}+`;
    case 'sus2': return `${numeral}sus2`;
    case 'sus4': return `${numeral}sus4`;
    default: return numeral; // major — uppercase as-is
  }
}

/**
 * Detect the most likely key centre of a progression: the tonic (0..11) that
 * makes the chords most diatonic (fewest accidental roman numerals). Independent
 * of how the chords are spelled or which key folder they came from. Tie-breaks
 * toward the first chord's root.
 * @param {Array<string|{root:number}>} chords
 */
export function bestTonic(chords) {
  const parsed = chords.map((c) => (typeof c === 'string' ? parseChordSymbol(c) : c)).filter(Boolean);
  if (parsed.length === 0) return 0;
  const firstRoot = parsed[0].root;

  let best = { tonic: 0, accidentals: Infinity };
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const accidentals = romanAnalysis(parsed, tonic).filter((r) => /[#b]/.test(r)).length;
    const betterCount = accidentals < best.accidentals;
    const tieToFirstRoot = accidentals === best.accidentals && tonic === firstRoot;
    if (betterCount || tieToFirstRoot) best = { tonic, accidentals };
  }
  return best.tonic;
}

/**
 * Analyse a progression into roman numerals relative to `tonic`.
 * @param {Array<string|{root:number,quality:string}>} chords
 * @param {number} tonic pitch class (0..11) of the key centre
 * @returns {string[]} one numeral per chord ('?' for unparseable)
 */
export function romanAnalysis(chords, tonic) {
  return chords.map((c) => {
    const parsed = typeof c === 'string' ? parseChordSymbol(c) : c;
    if (!parsed || parsed.root === undefined) return '?';
    const numeral = degreeNumeral(parsed.root - tonic);
    return styleByQuality(numeral, parsed.quality);
  });
}

export default romanAnalysis;
