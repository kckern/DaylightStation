import { describe, it, expect } from 'vitest';
import { clipWindow, bumpIncrement, bumpTarget } from './clipSeek.js';

describe('clip-scoped seek bumps', () => {
  it('reads a clip window only when it is a real span', () => {
    expect(clipWindow({ segment: { start: 1631.2, end: 1748 } })).toEqual({ start: 1631.2, end: 1748 });
    expect(clipWindow({ segment: { start: 10, end: 5 } })).toBeNull();
    expect(clipWindow({})).toBeNull();
    expect(clipWindow(null)).toBeNull();
  });

  it('sizes a bump to the clip, not the whole recording', () => {
    // A 117 s song inside a 98-minute concert: a few seconds, never ~2 minutes.
    expect(bumpIncrement(5889.6, { start: 1631.2, end: 1748 })).toBe(10);
    expect(bumpIncrement(5889.6, { start: 0, end: 600 })).toBe(20);
    expect(bumpIncrement(5889.6, { start: 0, end: 30 })).toBe(5);
  });

  it('keeps the whole-file bump for an item with no clip window', () => {
    expect(bumpIncrement(5000, null)).toBe(100);
    expect(bumpIncrement(100, null)).toBe(5);
    expect(bumpIncrement(NaN, null)).toBe(10);
  });

  it('never leaves the clip: forward stops at its end, back at its start', () => {
    const w = { start: 1631.2, end: 1748 };
    expect(bumpTarget(1740, 10, w, 5889.6)).toBe(1748);
    expect(bumpTarget(1635, -10, w, 5889.6)).toBe(1631.2);
    expect(bumpTarget(1700, 10, w, 5889.6)).toBe(1710);
  });

  it('clamps to the file when there is no clip window', () => {
    expect(bumpTarget(95, 10, null, 100)).toBe(100);
    expect(bumpTarget(3, -10, null, 100)).toBe(0);
  });
});
