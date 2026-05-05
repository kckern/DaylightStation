import { describe, it, expect } from 'vitest';
import { CadenceFilter } from './CadenceFilter.js';

describe('CadenceFilter — sanity clamp', () => {
  it('returns the raw value when within plausible range', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: 60, ts: 1000 }).rpm).toBe(60);
  });

  it('rejects values above the human plausibility ceiling (200 RPM)', () => {
    const f = new CadenceFilter();
    const result = f.update({ rpm: 11618, ts: 1000 });
    expect(result.rpm).toBe(0);
    expect(result.flags.implausible).toBe(true);
  });

  it('rejects negative values', () => {
    const f = new CadenceFilter();
    const result = f.update({ rpm: -5, ts: 1000 });
    expect(result.rpm).toBe(0);
    expect(result.flags.implausible).toBe(true);
  });

  it('rejects non-finite values (NaN, Infinity)', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: NaN,      ts: 1000 }).rpm).toBe(0);
    expect(f.update({ rpm: Infinity, ts: 2000 }).rpm).toBe(0);
  });
});

describe('CadenceFilter — EMA smoothing', () => {
  it('smooths a single zero-blip between live samples', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 55, ts: 1000 });
    f.update({ rpm: 55, ts: 1100 });
    f.update({ rpm: 55, ts: 1200 });
    const blip = f.update({ rpm: 0, ts: 1300 });
    expect(blip.rpm).toBeGreaterThan(30);
    expect(blip.rpm).toBeLessThan(55);
    expect(blip.flags.smoothed).toBe(true);
  });

  it('converges to the true value after several samples', () => {
    const f = new CadenceFilter();
    for (let i = 0; i < 10; i += 1) f.update({ rpm: 60, ts: 1000 + i * 100 });
    const settled = f.update({ rpm: 60, ts: 2000 });
    expect(settled.rpm).toBeGreaterThan(59);
    expect(settled.rpm).toBeLessThan(60.1);
  });

  it('the first sample passes through unsmoothed', () => {
    const f = new CadenceFilter();
    expect(f.update({ rpm: 50, ts: 1000 }).rpm).toBe(50);
  });

  it('treats an implausible value as a zero-blip for smoothing purposes (not a 200 spike)', () => {
    const f = new CadenceFilter();
    f.update({ rpm: 60, ts: 1000 });
    f.update({ rpm: 60, ts: 1100 });
    const result = f.update({ rpm: 11618, ts: 1200 });
    expect(result.rpm).toBeLessThan(60); // smoothed toward 0, not toward 200
    expect(result.rpm).toBeGreaterThan(20);
    expect(result.flags.implausible).toBe(true);
  });
});
