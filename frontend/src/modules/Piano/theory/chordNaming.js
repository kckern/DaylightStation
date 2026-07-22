// Pure chord identification: a set of MIDI notes → root, quality, inversion, and a
// human display name (e.g. "D minor", "C 7 / E", "C 9"). No React, no DOM.
//
// Pitch class = midi % 12. The lowest sounding MIDI note sets the bass (for
// inversion / slash spelling). v2 uses sharp spelling for roots.
//
// WHY A TIERED MATCHER (not a blind exact-match dictionary):
//   1. EXACT tier — the played pitch classes equal a template exactly. Among
//      exact reads (a set can be read from several roots — that IS what an
//      inversion is), we prefer ROOT POSITION (bass == root), then the lowest
//      inversion. This resolves genuine ambiguity by the bass: C-D-G with C in
//      the bass is "C sus2", not "G sus4" or "D7sus4".
//   2. TOLERANT tier — no exact read exists, so real playing (a dropped 5th, one
//      added tension) still names. Only the perfect 5th may be ABSENT, and at
//      most one sounding note may be UNEXPLAINED; anything looser is rejected as
//      "no chord" rather than mislabeled (a chromatic cluster stays nameless).
// Inversions are first-class: any root is tried, so C-E-G-Bb voiced E-G-Bb-C is
// still "C 7" (spelled "C 7 / E"), never a different chord.

/** Sharp-spelled pitch-class names (index 0..11 = C..B). */
export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const mod12 = (n) => ((n % 12) + 12) % 12;
const PERFECT_FIFTH = 7; // the one chord tone allowed to be absent in a real voicing

// Chord templates: intervals (semitones above root) → quality + display label.
// Ordered richest-first only for readability; matching does not depend on order.
// The vocabulary spans triads, sus, 6ths, the whole 7th family, adds and 9ths —
// deliberately broad so real voicings resolve to a real name.
const TEMPLATES = [
  // ── ninths ────────────────────────────────────────────────────────────────
  { quality: 'major9',       intervals: [0, 2, 4, 7, 11], label: 'major 9' },
  { quality: 'dominant9',    intervals: [0, 2, 4, 7, 10], label: '9' },
  { quality: 'minor9',       intervals: [0, 2, 3, 7, 10], label: 'minor 9' },
  { quality: 'six9',         intervals: [0, 2, 4, 7, 9],  label: '6/9' },
  // ── lydian (♯11 / ♯4) ────────────────────────────────────────────────────────
  // The ♯11 is lydian's characteristic tone; these are the chords that carry that
  // "lydian" color. (A mode is a scale, not a chord — see the note below the table.)
  { quality: 'major7sharp11', intervals: [0, 4, 6, 7, 11], label: 'major 7 ♯11' },
  { quality: 'addSharp11',    intervals: [0, 4, 6, 7],     label: 'add ♯11' },
  // ── sevenths ────────────────────────────────────────────────────────────────
  { quality: 'major7',       intervals: [0, 4, 7, 11],    label: 'major 7' },
  { quality: 'dominant7',    intervals: [0, 4, 7, 10],    label: '7' },
  { quality: 'minor7',       intervals: [0, 3, 7, 10],    label: 'minor 7' },
  { quality: 'minorMajor7',  intervals: [0, 3, 7, 11],    label: 'minor major 7' },
  { quality: 'minor7b5',     intervals: [0, 3, 6, 10],    label: 'minor 7 ♭5' },
  { quality: 'diminished7',  intervals: [0, 3, 6, 9],     label: 'diminished 7' },
  { quality: 'augmented7',   intervals: [0, 4, 8, 10],    label: '7 ♯5' },
  { quality: 'dominant7b5',  intervals: [0, 4, 6, 10],    label: '7 ♭5' },
  { quality: 'dominant7sus4', intervals: [0, 5, 7, 10],   label: '7 sus4' },
  // ── sixths ────────────────────────────────────────────────────────────────
  // These share a pitch-class set with a minor 7th rooted a minor 3rd below:
  //     sixth  [0,4,7,9] == minor7   [0,3,7,10]
  //     minor6 [0,3,7,9] == minor7b5 [0,3,6,10]
  // That is NOT a reason to drop them. This module resolves shared sets by the
  // BASS everywhere — C-D-G is "C sus2" or "G sus4"; a diminished 7th has four
  // names depending on which tone is lowest — and sixths follow the same rule.
  // C-E-G-A over C is "C 6"; the same notes over A are "A minor 7". Both are
  // what a player would call them, and root position (pickBest) decides.
  { quality: 'sixth',        intervals: [0, 4, 7, 9],     label: '6' },
  { quality: 'minor6',       intervals: [0, 3, 7, 9],     label: 'minor 6' },
  // ── added tone ──────────────────────────────────────────────────────────────
  { quality: 'add9',         intervals: [0, 2, 4, 7],     label: 'add9' },
  { quality: 'minorAdd9',    intervals: [0, 2, 3, 7],     label: 'minor add9' },
  { quality: 'add4',         intervals: [0, 4, 5, 7],     label: 'add4' },
  { quality: 'minorAdd4',    intervals: [0, 3, 5, 7],     label: 'minor add4' },
  // ── triads ────────────────────────────────────────────────────────────────
  { quality: 'major',        intervals: [0, 4, 7],        label: 'major' },
  { quality: 'minor',        intervals: [0, 3, 7],        label: 'minor' },
  { quality: 'diminished',   intervals: [0, 3, 6],        label: 'diminished' },
  { quality: 'augmented',    intervals: [0, 4, 8],        label: 'augmented' },
  { quality: 'sus2',         intervals: [0, 2, 7],        label: 'sus2' },
  { quality: 'sus4',         intervals: [0, 5, 7],        label: 'sus4' },
  // ── dyad ────────────────────────────────────────────────────────────────────
  { quality: 'power',        intervals: [0, 7],           label: '5' },
].map((t) => ({ ...t, set: new Set(t.intervals) }));

// NOTE ON MODES: this identifies CHORDS (a set of simultaneous pitch classes), not
// MODES (a scale + tonic — e.g. "C lydian"). A mode can't be read from one chord:
// "is this lydian?" depends on the melodic/harmonic context over time, not the four
// notes held now. What we CAN name is the chord that carries a mode's flavor — the
// ♯11 chords above give the lydian color. True mode detection would be a separate
// feature (rolling scale inference), akin to useDetectedKey but for mode.

/**
 * Position of `bassPc` within the chord's stacked tones (root + intervals),
 * used as the inversion index. Root position = 0; next chord tone up = 1; etc.
 *
 * Returns -1 when the bass is NOT a chord tone. That case must not be reported
 * as 0: claiming root position for a bass the chord cannot explain is a lie, and
 * it used to let a reading that ignored the bass outrank one that accounted for
 * it (C-C#-E-A named "A major", a name containing neither the C nor the C#).
 */
function inversionOf(root, template, bassPc) {
  const tones = template.intervals.map((iv) => mod12(root + iv));
  return tones.indexOf(mod12(bassPc));
}

/** Score one (root, template) reading of `relSet` (intervals present above root). */
function evaluate(root, template, relSet, bassPc) {
  let matched = 0;
  let missing = 0;
  let missingOnlyFifth = true;
  for (const iv of template.intervals) {
    if (relSet.has(iv)) matched += 1;
    else { missing += 1; if (iv !== PERFECT_FIFTH) missingOnlyFifth = false; }
  }
  const extra = relSet.size - matched; // sounding notes this reading can't explain
  const isPower = template.intervals.length === 2;

  // Eligibility — reject readings too loose to be a real name.
  if (isPower) {
    if (missing > 0 || extra > 0) return null; // a fifth is a fifth only when bare
  } else {
    if (matched < 3) return null;              // a named chord needs ≥3 of its tones
    if (!missingOnlyFifth || missing > 1) return null; // only the P5 may be absent
    if (extra > 1) return null;                // at most one unexplained note
  }
  const inversion = inversionOf(root, template, bassPc);
  return {
    root,
    template,
    inversion,
    explainsBass: inversion >= 0,
    matched,
    missing,
    extra,
    rootPosition: root === bassPc,
  };
}

/** Best reading of a candidate list: accounts for the bass FIRST (a reading that
 *  can't explain the sounding bass note is always worse than one that can), then
 *  root position, then lowest inversion, then most tones present, then fewest
 *  unexplained, then the simplest chord. */
function pickBest(candidates) {
  return candidates.sort((a, b) => (
    (b.explainsBass - a.explainsBass)
    || (b.rootPosition - a.rootPosition)
    || (a.inversion - b.inversion)
    || (b.matched - a.matched)
    || (a.extra - b.extra)
    || (a.template.intervals.length - b.template.intervals.length)
  ))[0];
}

/**
 * Identify a chord from a list of MIDI note numbers.
 * @param {number[]} midiNotes
 * @returns {{
 *   root: number|null, quality: string|null, inversion: number,
 *   displayName: string, bassPitchClass: number|null, notePitchClasses: number[]
 * }}
 */
export function identifyChord(midiNotes) {
  const notes = Array.isArray(midiNotes) ? midiNotes.filter((n) => Number.isFinite(n)) : [];
  const empty = {
    root: null, quality: null, inversion: 0,
    displayName: '', bassPitchClass: null, notePitchClasses: [],
  };
  if (notes.length === 0) return empty;

  const bassPc = mod12(Math.min(...notes));
  const pitchClasses = [...new Set(notes.map(mod12))].sort((a, b) => a - b);

  // Single note → just the note name.
  if (pitchClasses.length === 1) {
    return {
      ...empty,
      root: pitchClasses[0],
      displayName: PITCH_CLASS_NAMES[pitchClasses[0]],
      bassPitchClass: bassPc,
      notePitchClasses: pitchClasses,
    };
  }

  // Try every sounding pitch class as the root; collect exact vs tolerant reads.
  const exact = [];
  const tolerant = [];
  for (const root of pitchClasses) {
    const relSet = new Set(pitchClasses.map((pc) => mod12(pc - root)));
    for (const template of TEMPLATES) {
      const cand = evaluate(root, template, relSet, bassPc);
      if (!cand) continue;
      (cand.missing === 0 && cand.extra === 0 ? exact : tolerant).push(cand);
    }
  }

  const best = exact.length ? pickBest(exact) : (tolerant.length ? pickBest(tolerant) : null);
  if (!best) return { ...empty, bassPitchClass: bassPc, notePitchClasses: pitchClasses };

  const rootName = PITCH_CLASS_NAMES[best.root];
  let displayName = best.template.quality === 'power'
    ? `${rootName}5`
    : `${rootName} ${best.template.label}`;
  // Slash whenever the bass isn't the root — that covers real inversions AND a
  // bass the chord has no tone for (which must never read as root position).
  if (mod12(bassPc) !== best.root) displayName += ` / ${PITCH_CLASS_NAMES[bassPc]}`;

  return {
    root: best.root,
    quality: best.template.quality,
    inversion: best.inversion,
    displayName,
    bassPitchClass: bassPc,
    notePitchClasses: pitchClasses,
  };
}

export default identifyChord;
