import { describe, it, expect } from 'vitest';
import { DIVISIONS, decomposeDuration, durationToType } from './duration.js';

describe('DIVISIONS', () => {
  it('is 24 per quarter (divisible by 2/3/4/6/8)', () => {
    expect(DIVISIONS).toBe(24);
  });
});

describe('decomposeDuration', () => {
  it('returns a single palette value unchanged (quarter = 24)', () => {
    expect(decomposeDuration(24)).toEqual([{ type: 'quarter', divs: 24 }]);
  });
  it('decomposes a whole note (96)', () => {
    expect(decomposeDuration(96)).toEqual([{ type: 'whole', divs: 96 }]);
  });
  it('greedily ties 3.5 beats (84) into half+quarter+eighth', () => {
    expect(decomposeDuration(84)).toEqual([
      { type: 'half', divs: 48 },
      { type: 'quarter', divs: 24 },
      { type: 'eighth', divs: 12 },
    ]);
  });
  it('decomposes a dotted-quarter span (36) into quarter+eighth', () => {
    expect(decomposeDuration(36)).toEqual([
      { type: 'quarter', divs: 24 },
      { type: 'eighth', divs: 12 },
    ]);
  });
  it('decomposes one 16th (6)', () => {
    expect(decomposeDuration(6)).toEqual([{ type: '16th', divs: 6 }]);
  });
  it('throws on a non-grid (non-multiple-of-6) duration', () => {
    expect(() => decomposeDuration(5)).toThrow();
  });
});

describe('durationToType', () => {
  it('maps a plain quarter (24)', () => {
    expect(durationToType(24)).toEqual({ type: 'quarter', dots: 0 });
  });
  it('maps a dotted quarter (36)', () => {
    expect(durationToType(36)).toEqual({ type: 'quarter', dots: 1 });
  });
  it('maps a dotted half (72)', () => {
    expect(durationToType(72)).toEqual({ type: 'half', dots: 1 });
  });
  it('maps an 8th triplet (8)', () => {
    expect(durationToType(8)).toEqual({ type: 'eighth', dots: 0, triplet: true });
  });
  it('maps a quarter triplet (16)', () => {
    expect(durationToType(16)).toEqual({ type: 'quarter', dots: 0, triplet: true });
  });
  it('maps a 16th triplet (4)', () => {
    expect(durationToType(4)).toEqual({ type: '16th', dots: 0, triplet: true });
  });
  it('returns null for a non-expressible single value (84)', () => {
    expect(durationToType(84)).toBeNull();
  });
});
