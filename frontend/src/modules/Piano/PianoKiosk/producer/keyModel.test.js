import { describe, expect, it } from 'vitest';
import { sourceTonicPc, targetKeyPc, transposeToTargetKey } from './keyModel.js';

const libraryLayer = (tonicPc, role = 'chords') => ({
  role,
  source: { kind: 'library', entry: { tonicPc } },
});

describe('Producer key model', () => {
  it('lands every authored tonic on every target tonic', () => {
    for (let sourcePc = 0; sourcePc < 12; sourcePc += 1) {
      for (let targetPc = 0; targetPc < 12; targetPc += 1) {
        const transpose = transposeToTargetKey(libraryLayer(sourcePc), targetPc);
        expect(60 + sourcePc + transpose).toBe(60 + targetPc);
      }
    }
  });

  it('preserves the target octave chosen by shortest-path key nudges', () => {
    expect(targetKeyPc(-5)).toBe(7);
    expect(transposeToTargetKey(libraryLayer(7), -5)).toBe(-12);
    expect(transposeToTargetKey(libraryLayer(0), -5)).toBe(-5);
  });

  it('treats takes/builders and missing legacy tonic metadata as canonical C', () => {
    expect(sourceTonicPc({ kind: 'take' })).toBe(0);
    expect(sourceTonicPc({ kind: 'library', entry: {} })).toBe(0);
    expect(transposeToTargetKey({ role: 'melody', source: { kind: 'take' } }, 9)).toBe(9);
  });

  it('never transposes drum-map pitches', () => {
    expect(transposeToTargetKey(libraryLayer(5, 'groove'), 11)).toBe(0);
  });
});
