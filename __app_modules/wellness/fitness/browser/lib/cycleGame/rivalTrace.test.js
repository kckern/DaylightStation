import { describe, it, expect } from 'vitest';
import { rivalTraceSamples } from "./rivalTrace.js";

// series[i] = metres at (i + 1) × intervalS (the engine's ghost convention).
const series = [25, 50, 75, 100, 125, 150]; // 5 m/s at a 5 s interval, to 30 s

describe('rivalTraceSamples', () => {
  it('starts at the origin and follows the whole recording inside the window', () => {
    expect(rivalTraceSamples(series, 5, { windowS: 60 })).toEqual([
      { t: 0, d: 0 }, { t: 5, d: 25 }, { t: 10, d: 50 }, { t: 15, d: 75 },
      { t: 20, d: 100 }, { t: 25, d: 125 }, { t: 30, d: 150 }
    ]);
  });

  it('stops at the window edge with an interpolated end point', () => {
    expect(rivalTraceSamples(series, 5, { windowS: 12 })).toEqual([
      { t: 0, d: 0 }, { t: 5, d: 25 }, { t: 10, d: 50 }, { t: 12, d: 60 }
    ]);
  });

  it('ends at the goal line at the moment the rival crossed it', () => {
    expect(rivalTraceSamples(series, 5, { windowS: 60, goalM: 90 })).toEqual([
      { t: 0, d: 0 }, { t: 5, d: 25 }, { t: 10, d: 50 }, { t: 15, d: 75 }, { t: 18, d: 90 }
    ]);
  });

  it('decimates a long recording but keeps both ends', () => {
    const long = Array.from({ length: 3000 }, (_, i) => i + 1);
    const out = rivalTraceSamples(long, 1, { windowS: 5000, maxPoints: 600 });
    expect(out.length).toBeLessThanOrEqual(602);
    expect(out[0]).toEqual({ t: 0, d: 0 });
    expect(out[out.length - 1]).toEqual({ t: 3000, d: 3000 });
  });

  it('is empty for a missing series or window', () => {
    expect(rivalTraceSamples(null, 5, { windowS: 60 })).toEqual([]);
    expect(rivalTraceSamples([], 5, { windowS: 60 })).toEqual([]);
    expect(rivalTraceSamples(series, 5, { windowS: 0 })).toEqual([]);
  });
});
