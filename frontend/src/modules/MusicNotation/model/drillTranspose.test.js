import { describe, it, expect } from 'vitest';
import { diatonicTranspose, expandDrill, handMidiSequence } from './drillTranspose.js';

describe('diatonicTranspose', () => {
  it('shifts by scale degrees in C major (white keys)', () => {
    // C3(48) up one degree → D3(50); E3(52) → F3(53); B3(59) → C4(60)
    expect(diatonicTranspose(48, 1, 'C')).toBe(50);
    expect(diatonicTranspose(52, 1, 'C')).toBe(53);
    expect(diatonicTranspose(59, 1, 'C')).toBe(60);
  });

  it('shifts down and by an octave (7 degrees)', () => {
    expect(diatonicTranspose(50, -1, 'C')).toBe(48); // D3 → C3
    expect(diatonicTranspose(48, 7, 'C')).toBe(60);  // C3 → C4
    expect(diatonicTranspose(60, -7, 'C')).toBe(48); // C4 → C3
  });

  it('is identity for zero degrees', () => {
    expect(diatonicTranspose(64, 0, 'C')).toBe(64);
  });

  it('stays in-key in a sharp key (G major: F is F#)', () => {
    // G major scale includes F#(6). G4(67) up one degree → A4(69); E4(64) → F#4(66).
    expect(diatonicTranspose(67, 1, 'G')).toBe(69);
    expect(diatonicTranspose(64, 1, 'G')).toBe(66);
  });
});

// Hanon Exercise No. 1 seed (from the YAML), used to verify the expansion
// reproduces the canonical exercise.
const HANON_1 = {
  key: 'C',
  meter: '2/4',
  transpose: { mode: 'diatonic', direction: 'up-then-down', span_octaves: 2 },
  hands: {
    right: [
      { role: 'ascending', notes: [48, 52, 53, 55, 57, 55, 53, 52].map((midi) => ({ midi })) },
      { role: 'descending', notes: [79, 76, 74, 72, 71, 72, 74, 76].map((midi) => ({ midi })) },
    ],
    left: [
      { role: 'ascending', notes: [36, 40, 41, 43, 45, 43, 41, 40].map((midi) => ({ midi })) },
      { role: 'descending', notes: [67, 64, 62, 60, 59, 60, 62, 64].map((midi) => ({ midi })) },
    ],
  },
};

describe('expandDrill (Hanon No. 1)', () => {
  const expanded = expandDrill(HANON_1);

  it('produces 7·span measures per direction (28 for 2 octaves up-then-down)', () => {
    expect(expanded.hands.right).toHaveLength(28);
    expect(expanded.hands.left).toHaveLength(28);
    expect(expanded.expanded).toBe(true);
  });

  it('first ascending measure is the seed verbatim', () => {
    expect(expanded.hands.right[0].notes.map((n) => n.midi)).toEqual([48, 52, 53, 55, 57, 55, 53, 52]);
  });

  it('reproduces the canonical climb (m2, m3 shifted one/two scale degrees)', () => {
    // m2: D3 F3 G3 A3 B3 A3 G3 F3
    expect(expanded.hands.right[1].notes.map((n) => n.midi)).toEqual([50, 53, 55, 57, 59, 57, 55, 53]);
    // m3: E3 G3 A3 B3 C4 B3 A3 G3
    expect(expanded.hands.right[2].notes.map((n) => n.midi)).toEqual([52, 55, 57, 59, 60, 59, 57, 55]);
  });

  it('descending portion starts at the turnaround seed (top) and falls', () => {
    expect(expanded.hands.right[14].notes.map((n) => n.midi)).toEqual([79, 76, 74, 72, 71, 72, 74, 76]);
    // one degree down: F5 D5 C5 B4 A4 B4 C5 D5
    expect(expanded.hands.right[15].notes.map((n) => n.midi)).toEqual([77, 74, 72, 71, 69, 71, 72, 74]);
  });

  it('preserves fingering on the transposed copies', () => {
    const seed = { key: 'C', transpose: { direction: 'up', span_octaves: 1 }, hands: {
      right: [{ role: 'ascending', notes: [{ midi: 48, finger: 1 }, { midi: 52, finger: 2 }] }], left: [] } };
    const e = expandDrill(seed);
    expect(e.hands.right[1].notes[0].finger).toBe(1);
    expect(e.hands.right[1].notes[1].finger).toBe(2);
  });

  it('handMidiSequence flattens cells in order', () => {
    const seq = handMidiSequence(expanded.hands.right);
    expect(seq).toHaveLength(28 * 8);
    expect(seq.slice(0, 8)).toEqual([48, 52, 53, 55, 57, 55, 53, 52]);
  });

  it('returns the drill unchanged when there is no transpose rule', () => {
    const plain = { key: 'C', hands: { right: [{ notes: [{ midi: 60 }] }], left: [] } };
    expect(expandDrill(plain)).toBe(plain);
  });
});
