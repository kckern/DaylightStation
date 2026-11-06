import { describe, expect, it } from 'vitest';
import { makeTimebase, parseRate, ms } from './timebase.mjs';

describe('parseRate', () => {
  it('keeps rationals exact and snaps NTSC decimals', () => {
    expect(parseRate('24/1')).toEqual({ num: 24, den: 1 });
    expect(parseRate('24000/1001')).toEqual({ num: 24000, den: 1001 });
    expect(parseRate(23.976)).toEqual({ num: 24000, den: 1001 });
    expect(parseRate(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(parseRate(25)).toEqual({ num: 25000, den: 1000 });
    expect(() => parseRate('x')).toThrow(/invalid/);
  });
});

describe('makeTimebase', () => {
  const tb = makeTimebase({ fps: '24/1', startTime: 1 / 12 });

  it('round-trips every frame of an hour without drift', () => {
    for (let n = 0; n < 24 * 3600; n += 997) {
      expect(tb.frameAt(tb.frameStart(n))).toBe(n);
      expect(tb.frameAt(tb.frameMid(n))).toBe(n);
      expect(tb.frameAt(tb.frameEnd(n) - 1e-4)).toBe(n);
    }
  });

  it('round-trips at 24000/1001 across a feature length', () => {
    const ntsc = makeTimebase({ fps: '24000/1001' });
    for (const n of [0, 1, 1000, 100000, 172000]) expect(ntsc.frameAt(ntsc.frameStart(n))).toBe(n);
    expect(ntsc.frameStart(24000)).toBeCloseTo(1001, 9);
  });

  it('honours the stream start time', () => {
    expect(tb.frameStart(0)).toBeCloseTo(0.083333, 5);
    expect(tb.frameAt(0)).toBe(0);
    expect(tb.frameAt(0.125)).toBe(1);
  });

  it('turns an inclusive frame span into in/out player times', () => {
    expect(tb.spanToTimes(24, 47)).toEqual({ in: ms(1 + 1 / 12), out: ms(2 + 1 / 12) });
    expect(() => tb.spanToTimes(5, 4)).toThrow(/reversed/);
  });
});
