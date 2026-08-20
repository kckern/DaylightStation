import { describe, it, expect } from 'vitest';
import { toSpans, withOffsets } from './chapters.mjs';

describe('toSpans', () => {
  it('desugars starts + musicEndsAt into contiguous spans', () => {
    expect(toSpans({ starts: [21.35, 976, 1925, 2278], musicEndsAt: 2955, count: 4 })).toEqual([
      { start: 21.35, end: 976 }, { start: 976, end: 1925 },
      { start: 1925, end: 2278 }, { start: 2278, end: 2955 }
    ]);
  });

  it('takes explicit spans verbatim, so a gap between chapters survives', () => {
    expect(toSpans({ spans: [[12.4, 121.0], [128.6, 275.2]], count: 2 })).toEqual([
      { start: 12.4, end: 121.0 }, { start: 128.6, end: 275.2 }
    ]);
  });

  it('pads to count so a chapter with no timing keeps its position', () => {
    expect(toSpans({ spans: [[0, 10]], count: 3 })).toEqual([
      { start: 0, end: 10 }, { start: undefined, end: undefined }, { start: undefined, end: undefined }
    ]);
  });
});

describe('withOffsets', () => {
  it('lays chapters end to end on a sounding-time rail, skipping dead time', () => {
    const out = withOffsets([{ start: 10, end: 20 }, { start: 30, end: 45 }]);
    expect(out).toEqual([
      { start: 10, end: 20, duration: 10, offset: 0 },
      { start: 30, end: 45, duration: 15, offset: 10 }
    ]);
  });

  it('gives an untimed chapter zero duration and does not advance the rail', () => {
    const out = withOffsets([{ start: 0, end: 5 }, {}, { start: 5, end: 9 }]);
    expect(out.map((c) => c.offset)).toEqual([0, 5, 5]);
    expect(out[1].duration).toBe(0);
  });
});
