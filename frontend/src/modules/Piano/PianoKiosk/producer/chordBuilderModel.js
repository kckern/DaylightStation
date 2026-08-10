import { PPQ } from './useLoopCapture.js';
import { mintTakeId } from './producerIdentity.js';

// Deliberately small vocabulary: this is a fast, diatonic progression tool,
// not a theory editor. Its output is canonical C and follows the same target-
// key path as every other take in Producer.
export const DIATONIC_CHORDS = Object.freeze([
  { roman: 'I', offset: 0, quality: 'major' },
  { roman: 'ii', offset: 2, quality: 'minor' },
  { roman: 'iii', offset: 4, quality: 'minor' },
  { roman: 'IV', offset: 5, quality: 'major' },
  { roman: 'V', offset: 7, quality: 'major' },
  { roman: 'vi', offset: 9, quality: 'minor' },
  { roman: 'vii°', offset: 11, quality: 'dim' },
]);

const TRIAD = { major: [0, 4, 7], minor: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8] };
const ROOT_MIDI = 60;

export const CHORD_RHYTHMS = Object.freeze({
  sustain: [{ beat: 0, beats: 3.85, velocity: 86 }],
  pulse: [
    { beat: 0, beats: 0.78, velocity: 94 },
    { beat: 1, beats: 0.72, velocity: 76 },
    { beat: 2, beats: 0.78, velocity: 86 },
    { beat: 3, beats: 0.72, velocity: 76 },
  ],
  syncopated: [
    { beat: 0, beats: 1.45, velocity: 92 },
    { beat: 2.5, beats: 1.2, velocity: 82 },
  ],
});

/** Root-position spelling, retained as a small deterministic theory seam. */
export function chordTriadMidi(entry) {
  return TRIAD[entry.quality].map((iv) => ROOT_MIDI + entry.offset + iv);
}

function candidateVoicings(entry) {
  const base = chordTriadMidi(entry);
  const inversions = [
    base,
    [base[1], base[2], base[0] + 12],
    [base[2], base[0] + 12, base[1] + 12],
  ];
  return inversions.flatMap((notes) => [-12, 0, 12].map((shift) => notes.map((m) => m + shift)))
    .filter((notes) => notes[0] >= 48 && notes[notes.length - 1] <= 79);
}

/** Choose the nearest inversion so a progression behaves like a keyboard part,
 * rather than a sequence of root-position chord blocks leaping up the piano. */
export function voiceLeadChord(entry, previous = null) {
  const candidates = candidateVoicings(entry);
  const target = previous ?? [60, 64, 67];
  const score = (notes) => notes.reduce((sum, midi, i) => sum + Math.abs(midi - target[i]), 0)
    + Math.abs((notes[0] + notes[2]) / 2 - 64) * 0.05;
  return candidates.reduce((best, notes) => (score(notes) < score(best) ? notes : best), candidates[0]);
}

/** Build a canonical-C take with voice leading, a playable rhythm, harmonic
 * timeline, and enough provenance to explain/reopen how it was made. */
export function chordProgressionToTake(slots, { rhythm = 'pulse' } = {}) {
  const ppq = PPQ;
  const barTicks = ppq * 4;
  const pattern = CHORD_RHYTHMS[rhythm] ?? CHORD_RHYTHMS.pulse;
  const notes = [];
  const timelineSlots = [];
  let previous = null;

  slots.forEach((entry, bar) => {
    if (!entry) {
      timelineSlots.push([], [], [], []);
      return;
    }
    const voicing = voiceLeadChord(entry, previous);
    previous = voicing;
    for (const hit of pattern) {
      for (const midi of voicing) {
        notes.push({
          ticks: Math.round(bar * barTicks + hit.beat * ppq),
          durationTicks: Math.round(hit.beats * ppq),
          midi,
          velocity: hit.velocity,
        });
      }
    }
    const pitchClasses = chordTriadMidi(entry).map((m) => m % 12).sort((a, b) => a - b);
    timelineSlots.push(pitchClasses, pitchClasses, pitchClasses, pitchClasses);
  });

  notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return {
    takeId: mintTakeId('chords'),
    notes,
    ppq,
    lengthBars: slots.length,
    kind: 'chords',
    drumMode: false,
    timeline: { root: 0, slots: timelineSlots, specificity: 'triad' },
    builder: {
      kind: 'chords', version: 1, rhythm,
      roman: slots.map((entry) => entry?.roman ?? null),
    },
  };
}
