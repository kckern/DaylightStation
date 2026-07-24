import { describe, it, expect } from 'vitest';
import { coalesce } from './gestureCoalescer.js';
describe('gesture coalescing', () => {
  it('keeps at most one sample per frame window, preserving endpoints', () => {
    const samples = [
      { t: 0, x: 0, y: 0 }, { t: 4, x: 1, y: 1 }, { t: 8, x: 2, y: 2 },
      { t: 20, x: 5, y: 5 }, { t: 100, x: 9, y: 9 },
    ];
    const out = coalesce(samples, { frameMs: 16 });
    expect(out[0]).toEqual({ t: 0, x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ t: 100, x: 9, y: 9 });
    expect(out.length).toBe(3);
  });
  it('returns [] for empty input', () => { expect(coalesce([], {})).toEqual([]); });
});
