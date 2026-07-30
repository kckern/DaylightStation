import { describe, it, expect } from 'vitest';
import { keyLabel, abbrevKey } from './keyLabel.js';

describe('keyLabel', () => {
  it('major keys by fifths', () => {
    expect(keyLabel(0, 'major')).toBe('C major');
    expect(keyLabel(1, 'major')).toBe('G major');
    expect(keyLabel(-2, 'major')).toBe('Bb major');
  });
  it('minor keys use the relative-minor tonic (L1)', () => {
    expect(keyLabel(0, 'minor')).toBe('A minor');   // C major sig → A minor
    expect(keyLabel(1, 'minor')).toBe('E minor');   // G major sig → E minor
    expect(keyLabel(-3, 'minor')).toBe('C minor');  // Eb major sig → C minor
  });
  it('defaults to major when mode is absent', () => {
    expect(keyLabel(0)).toBe('C major');
    expect(keyLabel(3, null)).toBe('A major');
  });
  it('null for an out-of-range fifths', () => {
    expect(keyLabel(99, 'major')).toBeNull();
  });
});

describe('abbrevKey', () => {
  it('abbreviates major to M and minor to m', () => {
    expect(abbrevKey('D major')).toBe('DM');
    expect(abbrevKey('F# minor')).toBe('F#m');
    expect(abbrevKey('Bb major')).toBe('BbM');
  });
  it('passes null/undefined through', () => {
    expect(abbrevKey(null)).toBe(null);
    expect(abbrevKey(undefined)).toBe(undefined);
  });
});
