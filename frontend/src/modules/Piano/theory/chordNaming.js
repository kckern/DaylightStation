// Pure chord identification: a set of MIDI notes → root, quality, inversion, and a
// human display name (e.g. "D minor", "C major / E", "G 7"). No React, no DOM.
//
// Pitch class = midi % 12. Quality detection collapses to pitch classes; the lowest
// sounding MIDI note sets the bass for inversion. v1 uses sharp spelling for roots.

/** Sharp-spelled pitch-class names (index 0..11 = C..B). */
export const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Chord templates: intervals (semitones above root) → quality + label suffix.
// Order matters only for display; matching is by exact interval-set equality.
const TEMPLATES = [
  { quality: 'major',        intervals: [0, 4, 7],        label: 'major' },
  { quality: 'minor',        intervals: [0, 3, 7],        label: 'minor' },
  { quality: 'diminished',   intervals: [0, 3, 6],        label: 'diminished' },
  { quality: 'augmented',    intervals: [0, 4, 8],        label: 'augmented' },
  { quality: 'sus2',         intervals: [0, 2, 7],        label: 'sus2' },
  { quality: 'sus4',         intervals: [0, 5, 7],        label: 'sus4' },
  { quality: 'major7',       intervals: [0, 4, 7, 11],    label: 'major 7' },
  { quality: 'dominant7',    intervals: [0, 4, 7, 10],    label: '7' },
  { quality: 'minor7',       intervals: [0, 3, 7, 10],    label: 'minor 7' },
  { quality: 'minor7b5',     intervals: [0, 3, 6, 10],    label: 'minor 7 ♭5' },
  { quality: 'diminished7',  intervals: [0, 3, 6, 9],     label: 'diminished 7' },
  { quality: 'power',        intervals: [0, 7],           label: '5' },
];

const sigKey = (arr) => arr.slice().sort((a, b) => a - b).join(',');

// Map each template's sorted-interval signature → template, for O(1) lookup.
const TEMPLATE_BY_SIGNATURE = new Map(TEMPLATES.map((t) => [sigKey(t.intervals), t]));

/** Intervals of `pitchClasses` measured above `root`, de-duped + sorted. */
function intervalsAbove(root, pitchClasses) {
  const set = new Set(pitchClasses.map((pc) => ((pc - root) % 12 + 12) % 12));
  return [...set].sort((a, b) => a - b);
}

/**
 * Position of `bassPc` within the chord's stacked tones, used as the inversion index.
 * Root position = 0; the next chord tone up = 1; etc.
 */
function inversionOf(root, template, bassPc) {
  const tones = template.intervals.map((iv) => (root + iv) % 12);
  const idx = tones.indexOf(((bassPc % 12) + 12) % 12);
  return idx < 0 ? 0 : idx;
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

  const bassMidi = Math.min(...notes);
  const bassPc = ((bassMidi % 12) + 12) % 12;
  const pitchClasses = [...new Set(notes.map((n) => ((n % 12) + 12) % 12))].sort((a, b) => a - b);

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

  // Try each present pitch class as the candidate root; collect template matches.
  const matches = [];
  for (const root of pitchClasses) {
    const sig = sigKey(intervalsAbove(root, pitchClasses));
    const template = TEMPLATE_BY_SIGNATURE.get(sig);
    if (template) {
      matches.push({ root, template, inversion: inversionOf(root, template, bassPc) });
    }
  }

  if (matches.length === 0) {
    return { ...empty, bassPitchClass: bassPc, notePitchClasses: pitchClasses };
  }

  // Prefer the lowest inversion (root position first); tie-break on more chord tones.
  matches.sort((a, b) =>
    a.inversion - b.inversion ||
    b.template.intervals.length - a.template.intervals.length);
  const best = matches[0];

  const rootName = PITCH_CLASS_NAMES[best.root];
  let displayName = best.template.quality === 'power'
    ? `${rootName}5`
    : `${rootName} ${best.template.label}`;
  if (best.inversion > 0) {
    displayName += ` / ${PITCH_CLASS_NAMES[bassPc]}`;
  }

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
