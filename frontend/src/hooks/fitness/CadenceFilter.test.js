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
