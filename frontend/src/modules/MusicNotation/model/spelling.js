// MusicNotation model — enharmonic spelling. Which NAME does a pitch class get?
//
// A pitch class is a sound; a note name is notation. Twelve pitch classes, twenty-one
// usable names, and in equal temperament B♭ and A♯ are the same key — so the choice
// carries no acoustic information. It encodes function: where the note sits in the
// current key, and where it is going.
//
// Three tiers, strongest signal first:
//
//   1. IN THE KEY → spell it the way the key spells it. The 4th degree of F major is
//      B♭ and the leading tone of B major is A♯; same sound, opposite spelling, and
//      the key alone decides. This is the tier that fires most of the time.
//
//   2. CHROMATIC → spell by scale DEGREE relative to the tonic, not by absolute pitch
//      class. Chromatic notes divide cleanly by which way they lean:
//        +1  (♯1)  sharp — chromatic rise into 2
//        +3  (♭3)  flat  — the blues/borrowed third
//        +6  (♯4)  sharp — the most common chromatic note in any major key (V/V)
//        +8  (♭6)  flat  — borrowed from the parallel minor
//        +10 (♭7)  flat  — mixolydian/dominant seventh
//      Degree-relative is what makes this travel: in A major, pitch class 3 is the
//      raised 4th and correctly spells D♯, while in C major the same pitch class is
//      the flat 3rd and correctly spells E♭. A fixed per-pitch-class table gets one
//      of those two wrong no matter which way it is written.
//
//   3. CHORD ROOTS → quality breaks the two ties where convention disagrees with the
//      degree lean, because each is really a statement about the KEY the root implies:
//        +8 minor → G♯ minor (5♯), never A♭ minor (7♭)
//        +1 major → D♭ major (5♭), never C♯ major (7♯)
//      Tier 3 needs a chord to apply to. A lone chromatic note has no quality and
//      takes the tier-2 lean, so a passing C♯ in C major stays C♯.
//
// A CHORD, though, is spelled as a unit — see spellChord below. Tiers 1-3 pick the
// ROOT; the other tones follow the letters their degrees demand, which is the only way
// to keep a chord's letters alternating (G♯–B–D♯, not A♭–B–E♭).
//
// Known limitation: without voice-leading context, a chromatic note that resolves
// against its usual direction gets the conventional spelling rather than the locally
// correct one (a descending ♭2 shows as ♯1). Fixing that needs the note AFTER it,
// which a live display doesn't have yet.

// NOT the same speller as model/spellMidi.js, on purpose. spellMidi answers
// "how does the SOUNDING key spell this struck MIDI note" — fifths-keyed,
// returns {step, alter, octave}, and spells every non-diatonic note with
// SHARPS (wet ink has no chord/degree context to lean on). This module answers
// "how does this key/chord spell this pitch class" — degree-relative leans,
// chord-quality tie-breaks, octaveless. Merging them would change wet-ink
// chromatic spelling or force a fifths↔name bridge nobody consumes.

const mod12 = (n) => ((n % 12) + 12) % 12;

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// Semitones above the tonic for each degree of a major scale.
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

// Tier 2: does this chromatic degree lean sharp or flat? (Indexed by semitones above
// the tonic; only the five chromatic degrees are ever looked up.)
const CHROMATIC_LEANS_SHARP = { 1: true, 3: false, 6: true, 8: false, 10: false };
// Fallback spellings for the chromatic degrees, used when there is no key to lean on.
const SHARP_SPELL = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const FLAT_SPELL = [['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0], ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0]];

/** Signed alteration that turns `letter` into pitch class `pc` (−2..+2). */
function alterFor(letter, pc) {
  const diff = mod12(pc - NATURAL_PC[letter]);
  return diff > 6 ? diff - 12 : diff; // 11 → −1 (C♭ against C), 1 → +1 (B♯ against B)
}

/** Tonic pitch class and letter for a key name, from the name's own spelling. */
function tonicOf(keySig) {
  const letter = keySig[0]?.toUpperCase();
  if (!(letter in NATURAL_PC)) return null;
  const accidental = keySig.includes('#') ? 1 : keySig.includes('b') ? -1 : 0;
  return { letter, pc: mod12(NATURAL_PC[letter] + accidental) };
}

/**
 * The key's own seven spellings, pitch class → { letter, alter }.
 *
 * Derived from the key NAME rather than read from a table, because a major scale is
 * fully determined by its tonic: seven consecutive letters, each used once, with
 * whatever alteration makes the pitch come out right. That is what produces E♯ for
 * F♯ major and C♭ for G♭ major — spellings no 12-entry pitch-class table can hold,
 * and whose absence made tier 1 print the leading tone of F♯ major as F♮ with a
 * natural sign against it.
 *
 * It also means this does NOT depend on KEY_SIGNATURES.scale, which had G♭ major's
 * scale byte-identical to D♭'s (C♮ where C♭ belongs).
 */
const keyScaleCache = new Map();
function keyScale(keySig) {
  if (keyScaleCache.has(keySig)) return keyScaleCache.get(keySig);
  const tonic = tonicOf(keySig);
  const map = new Map();
  if (tonic) {
    const start = LETTERS.indexOf(tonic.letter);
    for (let degree = 0; degree < 7; degree += 1) {
      const letter = LETTERS[(start + degree) % 7];
      const pc = mod12(tonic.pc + MAJOR_STEPS[degree]);
      map.set(pc, { letter, alter: alterFor(letter, pc) });
    }
  }
  keyScaleCache.set(keySig, map);
  return map;
}

/**
 * Spell a pitch class as a letter + alteration.
 *
 * @param {number} pc - pitch class 0-11 (any integer; reduced mod 12)
 * @param {object} [opts]
 * @param {string} [opts.keySignature='C'] - major key name, e.g. 'F', 'Bb', 'F#'
 * @param {'major'|'minor'|null} [opts.rootQuality=null] - the quality of the chord this
 *   pitch class is the ROOT of, when it is one. Tier 3 only. `null` means "just a note"
 *   — a lone chromatic pitch has no chord to take a side, so it gets the degree lean.
 * @returns {{ letter: string, alter: -1|0|1 }}
 */
export function spellPitchClass(pc, { keySignature = 'C', rootQuality = null } = {}) {
  const p = mod12(pc);
  const tonic = tonicOf(keySignature);
  const key = tonic ? keySignature : 'C';

  // Tier 1 — the key already has an opinion about this pitch class.
  const inKey = keyScale(key).get(p);
  if (inKey) return inKey;

  // Tier 2 — chromatic: lean by scale degree, so the rule travels across keys.
  const degree = mod12(p - (tonic ?? tonicOf('C')).pc);
  let sharp = CHROMATIC_LEANS_SHARP[degree] ?? false;

  // Tier 3 — chord quality breaks the two ties where convention disagrees with the
  // degree lean. Both are about which KEY the root implies, so both are quality-split:
  //   ♭6 minor → G♯ minor (5♯), never A♭ minor (7♭)
  //   ♭2 major → D♭ major (5♭), never C♯ major (7♯)
  // The degree rule alone spells +1 sharp for both qualities, which is right for C♯
  // minor and wrong for D♭ major — an earlier comment here claimed this case "falls
  // out of tier 2". It does not.
  if (degree === 8 && rootQuality === 'minor') sharp = true;
  if (degree === 1 && rootQuality === 'major') sharp = false;

  const [letter, alter] = (sharp ? SHARP_SPELL : FLAT_SPELL)[p];
  return { letter, alter };
}

/**
 * Spell a whole chord as a unit: pitch class → { letter, alter } for each tone.
 *
 * Spelling notes one at a time cannot honour the strongest rule in notation — a
 * tertian chord is a stack of thirds, so it uses alternating letters, each once.
 * Per-note spelling produced G♯ minor as A♭–B–E♭: three letters that stack in no
 * triad, and which disagreed with the "G♯ minor" printed beside them.
 *
 * Here the ROOT is spelled by the three tiers, and every other tone takes the letter
 * its DEGREE demands (a 3rd is two letters up from the root, a 7th is six), with
 * whatever alteration makes the pitch right.
 *
 * A tone needing a double accidental is left out rather than printed: the honest
 * spelling of a diminished 7th is a ♭♭7 (C dim7 = C–E♭–G♭–B𝄫), which is correct and
 * unreadable on a kiosk a child uses. Those tones fall back to the per-note tiers,
 * giving the familiar enharmonic (A instead of B𝄫). The trade is deliberate: this
 * display mirrors a keyboard, it is not an engraving tool.
 *
 * @param {number} root - root pitch class
 * @param {Array<[number, number]>} toneDegrees - [semitonesAboveRoot, diatonicDegree]
 *   pairs, degree 1-indexed (1 = root, 3 = third, 7 = seventh, 9 = ninth…)
 * @param {object} [opts] - { keySignature, rootQuality } for the root's own spelling
 * @returns {Map<number, {letter: string, alter: number}>} keyed by pitch class
 */
export function spellChord(root, toneDegrees, opts = {}) {
  const spelling = new Map();
  const rootSpelling = spellPitchClass(root, opts);
  const rootLetterIndex = LETTERS.indexOf(rootSpelling.letter);
  for (const [semitones, degree] of toneDegrees) {
    const pc = mod12(root + semitones);
    if (spelling.has(pc)) continue;
    const letter = LETTERS[(rootLetterIndex + degree - 1) % 7];
    const alter = alterFor(letter, pc);
    // Double accidentals are dropped to the per-note fallback (see above).
    if (Math.abs(alter) > 1) continue;
    spelling.set(pc, { letter, alter });
  }
  return spelling;
}

/** Unicode accidental for an alteration (−1 ♭, 0 none, +1 ♯). */
export const accidentalGlyph = (alter) => (alter === 1 ? '♯' : alter === -1 ? '♭' : '');

/**
 * Display name for a pitch class, e.g. 'B♭', 'F♯', 'C'. Uses the real ♯/♭ glyphs so
 * a root reads as one piece with the chord labels, which already use them ('7 ♭5').
 */
export function spellNoteName(pc, opts) {
  const { letter, alter } = spellPitchClass(pc, opts);
  return `${letter}${accidentalGlyph(alter)}`;
}

/** True when a chord quality counts as minor-ish for tier 3. */
export const isMinorish = (quality) =>
  typeof quality === 'string' && (quality.startsWith('minor') || quality.startsWith('diminished'));

/**
 * A chord quality string → the tier-3 side it takes, or null when there is no chord.
 * Keep this the single place the mapping lives; two copies drift.
 */
export const rootQualityOf = (quality) =>
  (typeof quality === 'string' ? (isMinorish(quality) ? 'minor' : 'major') : null);

export default spellNoteName;
