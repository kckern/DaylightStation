import { describe, it, expect } from 'vitest';
import { segmentsOf, mapTime, unmapTime, mapSpan, snapToFrames } from './syncMap.mjs';

const single = { scale: 0.999184, offsetSec: 8.155 };
const cut = {
  segments: [
    { fromVa: 0, toVa: 3120, scale: 1, offsetSec: 8 },
    { fromVa: 3120, toVa: 4000, scale: 1, offsetSec: 41.9 },
    // VidAngel 4000-4100 is missing from this copy
    { fromVa: 4100, toVa: 7000, scale: 1, offsetSec: -58.1 },
  ],
};

describe('segmentsOf', () => {
  it('treats a plain sync as one unbounded segment', () => {
    expect(segmentsOf(single)).toEqual([{ fromVa: -Infinity, toVa: Infinity, scale: 0.999184, offsetSec: 8.155 }]);
  });
  it('treats no sync as identity', () => {
    expect(segmentsOf(null)).toEqual([{ fromVa: -Infinity, toVa: Infinity, scale: 1, offsetSec: 0 }]);
  });
});

describe('mapTime', () => {
  it('applies scale and offset', () => {
    expect(mapTime(1000, single)).toBeCloseTo(1000 * 0.999184 + 8.155, 9);
  });
  it('handles PAL speed-up as a scale', () => {
    expect(mapTime(2500, { scale: 25 / 23.976, offsetSec: 0 })).toBeCloseTo(2500 * 25 / 23.976, 9);
  });
  it('picks the segment containing the time', () => {
    expect(mapTime(100, cut)).toBe(108);
    expect(mapTime(3500, cut)).toBeCloseTo(3541.9, 9);
    expect(mapTime(5000, cut)).toBeCloseTo(4941.9, 9);
  });
  it('returns null for a time this copy does not have', () => {
    expect(mapTime(4050, cut)).toBeNull();
  });
  it('round-trips within 1 ms', () => {
    for (const s of [single, cut, { scale: 25 / 23.976, offsetSec: -3.2 }]) {
      for (const va of [0.5, 777.417, 3119.999, 3120, 4100.25, 6145]) {
        const local = mapTime(va, s);
        if (local == null) continue;
        expect(Math.abs(unmapTime(local, s) - va)).toBeLessThan(0.001);
      }
    }
  });
});

describe('mapSpan', () => {
  it('maps a span inside one segment', () => {
    expect(mapSpan(100, 102, cut)).toEqual([{ in: 108, out: 110 }]);
  });
  it('splits a span that crosses a segment boundary', () => {
    const parts = mapSpan(3110, 3130, cut);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ in: 3118, out: 3128 });
    expect(parts[1].in).toBeCloseTo(3161.9, 9);
    expect(parts[1].out).toBeCloseTo(3171.9, 9);
  });
  it('clips the part that falls in a missing scene', () => {
    const parts = mapSpan(3990, 4110, cut);
    expect(parts).toHaveLength(2);
    expect(parts[0].out).toBeCloseTo(4041.9, 9);
    expect(parts[1].in).toBeCloseTo(4041.9, 9);
    expect(parts[1].out).toBeCloseTo(4051.9, 9);
  });
  it('returns nothing for a span entirely inside a missing scene', () => {
    expect(mapSpan(4010, 4090, cut)).toEqual([]);
  });
});

describe('snapToFrames', () => {
  const frames = { fps: '24/1', startTime: 0.083333 };
  it('moves in to the start of its frame and out to the end of its frame', () => {
    // frame 100 starts at 0.083333 + 100/24 = 4.250000
    const s = snapToFrames({ in: 4.27, out: 4.31 }, frames);
    expect(s.in).toBeCloseTo(4.25, 6);
    expect(s.out).toBeCloseTo(4.25 + 2 / 24, 6);
  });
  it('keeps an edge already on a frame boundary', () => {
    const s = snapToFrames({ in: 4.25, out: 4.25 + 3 / 24 }, frames);
    expect(s.in).toBeCloseTo(4.25, 6);
    expect(s.out).toBeCloseTo(4.25 + 3 / 24, 6);
  });
  it('keeps a boundary that comes back half a millisecond off after ms rounding', () => {
    const s = snapToFrames({ in: 4.25 + 0.0005, out: 4.25 + 3 / 24 + 0.0005 }, frames);
    expect(s.in).toBeCloseTo(4.25, 6);
    expect(s.out).toBeCloseTo(4.25 + 3 / 24, 6);
  });
  it('works at NTSC fractional rates', () => {
    const f = { fps: '24000/1001', startTime: 0 };
    const s = snapToFrames({ in: 10.0, out: 10.0 }, f);
    const dur = 1001 / 24000;
    expect(s.in).toBeCloseTo(Math.floor(10 / dur) * dur, 6);
    expect(s.out - s.in).toBeCloseTo(dur, 6);
  });
  it('leaves times alone without a frame grid', () => {
    expect(snapToFrames({ in: 1.234, out: 2.345 }, null)).toEqual({ in: 1.234, out: 2.345 });
  });
});
