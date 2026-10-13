import { describe, it, expect } from 'vitest';
import { keyedChordName } from './keyedChordName.js';

describe('keyedChordName', () => {
  const D = 2; // tonic D → Roman I = D

  it('spells the tonic and its sus figure in key D', () => {
    expect(keyedChordName('I', D)).toBe('D');
    expect(keyedChordName('Isus4', D)).toBe('Dsus4');
    expect(keyedChordName('Isus2', D)).toBe('Dsus2');
  });

  it('spells diatonic degrees in key D', () => {
    expect(keyedChordName('IV', D)).toBe('G');
    expect(keyedChordName('V', D)).toBe('A');
    expect(keyedChordName('vi', D)).toBe('Bm');   // minor → m
    expect(keyedChordName('ii', D)).toBe('Em');
    expect(keyedChordName('iii', D)).toBe('F#m');
  });

  it('carries the seventh / extension figure', () => {
    expect(keyedChordName('V7', D)).toBe('A7');
    expect(keyedChordName('ii7', D)).toBe('Em7');
  });

  it('applies flat / sharp accidentals to the degree root', () => {
    expect(keyedChordName('bVII', D)).toBe('C');   // D + 10 semitones
    expect(keyedChordName('bIII', D)).toBe('F');   // D + 3
    expect(keyedChordName('bVI', D)).toBe('Bb');   // D + 8
  });

  it('marks diminished and augmented qualities', () => {
    expect(keyedChordName('vii°', D)).toBe('C#°');
    expect(keyedChordName('I+', D)).toBe('D+');
  });

  it('spells in C when tonic is 0', () => {
    expect(keyedChordName('I', 0)).toBe('C');
    expect(keyedChordName('IV', 0)).toBe('F');
    expect(keyedChordName('vi', 0)).toBe('Am');
  });

  it('returns null for an unparseable token or non-numeric tonic', () => {
    expect(keyedChordName('?', D)).toBeNull();
    expect(keyedChordName('I', null)).toBeNull();
    expect(keyedChordName('I', undefined)).toBeNull();
  });
});
