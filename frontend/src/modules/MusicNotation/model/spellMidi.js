// spellMidi.js — key-aware MIDI → MusicXML-style pitch spelling (wave-3 D).
// PendingLayer deliberately refuses midi round-trips because generic helpers
// guess the clef and coin-flip the accidental; this helper is the missing
// bridge: spell from the SOUNDING key signature, sharps-default otherwise.

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
const SHARP_SPELL = [
  { step: 'C', alter: 0 }, { step: 'C', alter: 1 }, { step: 'D', alter: 0 },
  { step: 'D', alter: 1 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 },
  { step: 'F', alter: 1 }, { step: 'G', alter: 0 }, { step: 'G', alter: 1 },
  { step: 'A', alter: 0 }, { step: 'A', alter: 1 }, { step: 'B', alter: 0 },
];

/** Per-letter alteration of a key signature (-1 flat, 0 natural, 1 sharp). */
export function keyAlterations(fifths) {
  const map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  const n = Math.max(-7, Math.min(7, Math.trunc(fifths) || 0));
  if (n > 0) for (let i = 0; i < n; i++) map[SHARP_ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < -n; i++) map[FLAT_ORDER[i]] = -1;
  return map;
}

/** Sounding key signature after a transpose (fifths move 7 per semitone). */
export function soundingFifths(fifths, semitones) {
  const f = Math.trunc(fifths) || 0;
  const s = Math.trunc(semitones) || 0;
  if (!s) return f;
  let out = (((f + s * 7) % 12) + 12) % 12;
  if (out > 6) out -= 12;
  return out;
}

/** Spell a midi number in the given key. Diatonic → the key's spelling; else sharps. */
export function spellMidi(midi, fifths = 0) {
  const pc = ((midi % 12) + 12) % 12;
  const alts = keyAlterations(fifths);
  for (const step of LETTERS) {
    if ((((LETTER_PC[step] + alts[step]) % 12) + 12) % 12 === pc) {
      const alter = alts[step];
      return { step, alter, octave: (midi - LETTER_PC[step] - alter) / 12 - 1 };
    }
  }
  const s = SHARP_SPELL[pc];
  return { step: s.step, alter: s.alter, octave: (midi - LETTER_PC[s.step] - s.alter) / 12 - 1 };
}

export default { spellMidi, soundingFifths, keyAlterations };
