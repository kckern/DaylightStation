import { describe, it, expect } from 'vitest';
import { detectKey, KEY_SIGNATURES } from './keySignature.js';

describe('KEY_SIGNATURES', () => {
  it('every key has a 7-note scale', () => {
    for (const data of Object.values(KEY_SIGNATURES)) {
      expect(data.scale).toHaveLength(7);
    }
  });
});

describe('detectKey', () => {
  it('returns current key when too few notes (<5)', () => {
    expect(detectKey([0, 4, 7], 'F')).toBe('F');
  });

  it('returns current key when too few unique pitches (<3)', () => {
    expect(detectKey([0, 0, 0, 0, 0, 0], 'F')).toBe('F');
  });

  it('resolves a G-major run to G from C (tonic/dominant + F#)', () => {
    // G B D … A F# E G — emphasizes G tonic, D dominant, F# leading tone.
    const pcs = [7, 11, 2, 7, 11, 2, 9, 6, 4, 7];
    expect(detectKey(pcs, 'C')).toBe('G');
  });

  it('resolves an F-major run to F from C (tonic/dominant + Bb)', () => {
    // F A C … Bb C F — emphasizes F tonic, C dominant, includes Bb.
    const pcs = [5, 9, 0, 5, 9, 0, 10, 5, 7, 5];
    expect(detectKey(pcs, 'C')).toBe('F');
  });

  it('resolves a D-major arpeggio to D from C', () => {
    // D F# A … E C# D — D tonic, A dominant, C# leading tone.
    const pcs = [2, 6, 9, 2, 6, 9, 4, 1, 11, 2];
    expect(detectKey(pcs, 'D')).toBe('D');
    expect(detectKey(pcs, 'C')).toBe('D');
  });

  it('holds the settled key when a rival only marginally edges it (hysteresis)', () => {
    // C-major triad heavy with a light G lean: G scores only ~1% above C,
    // well inside the relative hysteresis margin, so C must hold.
    const pcs = [0, 4, 7, 0, 4, 7, 2, 11, 9, 6, 7];
    expect(detectKey(pcs, 'C')).toBe('C');
  });

  it('returns a sane key for clear C-major material with no currentKey arg', () => {
    // Guards the Producer.jsx one-shot: detectKey(notes.map(n => n.midi % 12)).
    const pcs = [0, 2, 4, 5, 7, 9, 11, 0, 4, 7];
    expect(detectKey(pcs)).toBe('C');
  });
});
