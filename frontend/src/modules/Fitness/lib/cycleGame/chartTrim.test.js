import { describe, it, expect } from 'vitest';
import { plotStartIndex } from './chartTrim.js';

describe('plotStartIndex', () => {
  it('starts at the origin for a rider moving from the first tick', () => {
    expect(plotStartIndex([10, 20, 30])).toBe(0);
  });
  it('starts just before first movement for a penalty-boxed late starter', () => {
    // boxed for indices 0,1,2 (distance 0), first moves at index 3 → anchor at 2
    expect(plotStartIndex([0, 0, 0, 15, 40])).toBe(2);
  });
  it('returns -1 when the rider never moved (draw no line)', () => {
    expect(plotStartIndex([0, 0, 0])).toBe(-1);
  });
  it('returns -1 for an empty or missing series', () => {
    expect(plotStartIndex([])).toBe(-1);
    expect(plotStartIndex(undefined)).toBe(-1);
  });
  it('handles a single moving sample', () => {
    expect(plotStartIndex([5])).toBe(0);
  });
});
