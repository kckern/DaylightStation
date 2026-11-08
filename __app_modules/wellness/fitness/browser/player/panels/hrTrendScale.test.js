import { describe, expect, it } from 'vitest';
import { ageAtX, buildPrefix, logX, sampleTrend, TREND_SLOTS } from './hrTrendScale.js';

describe('logX / ageAtX', () => {
  it('maps now to 1 and the session start to 0, and is near-linear when span << k', () => {
    expect(logX(0, 360)).toBe(1);
    expect(logX(360, 360)).toBe(0);
    expect(logX(12, 360)).toBeCloseTo(1 - Math.log(2) / Math.log(31), 6); // ≈0.798
    expect(logX(1, 2)).toBeCloseTo(0.5, 1);
    expect(logX(5, 0)).toBe(1);
  });
  it('ageAtX inverts logX', () => {
    for (const a of [0, 1, 7.5, 60, 359]) expect(ageAtX(logX(a, 360), 360)).toBeCloseTo(a, 6);
  });
});

describe('buildPrefix', () => {
  it('counts only finite positive readings', () => {
    const p = buildPrefix([100, null, 0, 120]);
    expect(p.length).toBe(4);
    expect([...p.count]).toEqual([0, 1, 1, 1, 2]);
    expect(p.sum[4]).toBe(220);
  });
});

describe('sampleTrend', () => {
  it('keeps recent ticks as individual points and averages old ones into slots', () => {
    const hr = Array.from({ length: 360 }, (_, i) => 100 + (i % 7));
    const pts = sampleTrend(buildPrefix(hr), { head: 359, lastIndex: 359 });
    expect(pts.at(-1).x).toBeCloseTo(100, 6);
    expect(pts.at(-1).hr).toBe(hr[359]);
    expect(pts.at(-2).hr).toBe(hr[358]); // recent: 1:1
    expect(pts[0].hr).not.toBe(hr[0]); // old: averaged
    expect(pts.every((p, i) => i === 0 || p.x > pts[i - 1].x)).toBe(true);
  });
  it('a slot or tick with no reading becomes a null point (a gap), even in the recent region', () => {
    const hr = [...Array(100).fill(120), null, null, null, null, null, null, 130, 131];
    const pts = sampleTrend(buildPrefix(hr), { head: hr.length - 1, lastIndex: hr.length - 1 });
    expect(pts.filter((p) => p.hr === null).length).toBeGreaterThanOrEqual(1);
    expect(pts.at(-1).hr).toBe(131);
  });
  it('stays bounded for a three-hour session', () => {
    const hr = Array.from({ length: 2160 }, () => 140);
    const pts = sampleTrend(buildPrefix(hr), { head: 2159, lastIndex: 2159 });
    expect(pts.length).toBeLessThanOrEqual(TREND_SLOTS + 1);
  });
  it('excludes indices beyond lastIndex (the animated tip is appended by the caller)', () => {
    const pts = sampleTrend(buildPrefix([100, 110, 120, 200]), { head: 2.5, lastIndex: 2 });
    expect(pts.some((p) => p.hr === 200)).toBe(false);
  });
});
