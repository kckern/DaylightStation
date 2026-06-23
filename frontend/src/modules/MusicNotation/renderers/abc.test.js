import { describe, it, expect } from 'vitest';
import { midiToAbc, generateAbc } from './abc.js';

describe('midiToAbc', () => {
  it('middle C is "C" in C major', () => {
    expect(midiToAbc(60, 'C')).toBe('C');
  });
  it('octave up uses lowercase', () => {
    expect(midiToAbc(72, 'C')).toBe('c');
  });
  it('octave down uses commas', () => {
    expect(midiToAbc(48, 'C')).toBe('C,');
  });
  it('F# in G major needs no accidental (key handles it)', () => {
    expect(midiToAbc(66, 'G')).toBe('F');
  });
  it('F# in C major needs an explicit sharp', () => {
    expect(midiToAbc(66, 'C')).toBe('^F');
  });
});

describe('generateAbc', () => {
  it('renders a single treble note on the RH staff', () => {
    const abc = generateAbc(new Map([[60, {}]]), 'C');
    expect(abc).toContain('[V:RH] x x C x x |]');
    expect(abc).toContain('[V:LH] x x x x x |]');
    expect(abc).toContain('K:C');
  });
  it('puts an octave dyad on the bass staff', () => {
    const abc = generateAbc(new Map([[48, {}], [60, {}]]), 'C');
    expect(abc).toContain('[V:LH] x x [C,C] x x |]');
  });
  it('applies 8va for very high notes', () => {
    const abc = generateAbc(new Map([[96, {}]]), 'C');
    expect(abc).toContain('8va');
  });
});
