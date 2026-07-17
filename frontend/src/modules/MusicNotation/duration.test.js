import { describe, it, expect } from 'vitest';
import { DIVISIONS, decomposeDuration } from './duration.js';

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
