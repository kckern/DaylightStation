import { describe, it, expect } from 'vitest';
import {
  detectChords,
  gradeChord,
  gradeInterval,
  scaleChromas,
  gradeScaleStep,
  progressionChords,
  midiToChroma,
} from './theoryEngine.js';

describe('detectChords', () => {
  it('names a C major triad from MIDI notes', () => {
    expect(detectChords([60, 64, 67])).toContain('CM');
  });
});

describe('gradeChord', () => {
  it('accepts a correct Dm7 in any voicing/octave', () => {
    // D F A C across octaves, out of order.
    const result = gradeChord('Dm7', [62, 81, 65, 72]);
    expect(result.correct).toBe(true);
  });
  it('rejects a wrong chord', () => {
    expect(gradeChord('Dm7', [60, 64, 67]).correct).toBe(false);
  });
});

describe('gradeInterval', () => {
  it('accepts a perfect fifth above C4', () => {
    expect(gradeInterval(60, '5P', 67).correct).toBe(true);
  });
  it('rejects a wrong interval', () => {
    expect(gradeInterval(60, '5P', 66).correct).toBe(false);
  });
});

describe('scaleChromas / gradeScaleStep', () => {
  it('G major chromas start on G', () => {
    expect(scaleChromas('G major')[0]).toBe(midiToChroma(67)); // G
  });
  it('grades the first ascending step', () => {
    expect(gradeScaleStep('C major', 0, 60).correct).toBe(true); // C
    expect(gradeScaleStep('C major', 1, 62).correct).toBe(true); // D
    expect(gradeScaleStep('C major', 1, 61).correct).toBe(false);
  });
});

describe('progressionChords', () => {
  it('expands a ii-V-I in C (quality from the numeral suffix)', () => {
    // tonal takes chord quality from the suffix, not letter case.
    expect(progressionChords('C', ['IIm7', 'V7', 'Imaj7'])).toEqual([
      'Dm7', 'G7', 'Cmaj7',
    ]);
  });
});
