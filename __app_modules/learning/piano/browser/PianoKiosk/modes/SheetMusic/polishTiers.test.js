import { describe, it, expect } from 'vitest';
import { tierOf, runScore, displayScore } from './polishTiers.js';

describe('tierOf', () => {
  it('buckets by tempoMult at run start', () => {
    expect(tierOf(0.7)).toBe('slow');
    expect(tierOf(0.8)).toBe('medium');
    expect(tierOf(0.9)).toBe('medium');
    expect(tierOf(1)).toBe('full');
    expect(tierOf(1 + 5e-7)).toBe('full');   // ±1e-6 tolerance
    expect(tierOf(1.1)).toBe('overclocked');
  });
});

describe('runScore', () => {
  it('means combined over non-rest measures only', () => {
    const grades = {
      0: { combined: 1, rest: true },     // rest bar — excluded
      1: { combined: 0.8, rest: false },
      2: { combined: 0.6, rest: false },
    };
    expect(runScore(grades)).toBe(70);
  });
  it('null when nothing gradeable', () => {
    expect(runScore({})).toBe(null);
    expect(runScore({ 0: { combined: 1, rest: true } })).toBe(null);
  });
});

describe('displayScore', () => {
  it('overclocked earns the 1.25 multiplier and may exceed 100', () => {
    expect(displayScore(90, 'overclocked')).toBe(113);
    expect(displayScore(90, 'full')).toBe(90);
  });
});
