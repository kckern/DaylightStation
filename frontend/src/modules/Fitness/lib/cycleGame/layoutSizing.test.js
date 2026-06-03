import { describe, it, expect } from 'vitest';
import { columnTemplateFor, fitScale, gaugeRowSize } from './layoutSizing.js';

describe('columnTemplateFor', () => {
  it('weights a focus panel wider than standard ones', () => {
    expect(columnTemplateFor(['focus', 'standard'])).toBe('2fr 1fr');
  });
  it('gives equal columns to all-standard zones', () => {
    expect(columnTemplateFor(['standard', 'standard', 'standard'])).toBe('1fr 1fr 1fr');
  });
  it('falls back to a single full column when empty', () => {
    expect(columnTemplateFor([])).toBe('1fr');
  });
  it('treats unknown hints as standard weight', () => {
    expect(columnTemplateFor(['mystery', 'focus'])).toBe('1fr 2fr');
  });
});

describe('fitScale', () => {
  it('returns 1 when content already fits', () => {
    expect(fitScale({ width: 100, height: 80 }, { width: 200, height: 200 })).toBe(1);
  });
  it('returns the limiting ratio (<1) when content overflows', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 200, height: 200 })).toBe(0.5);
  });
  it('returns 1 for any non-positive dimension (nothing to scale)', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 200, height: 200 })).toBe(1);
    expect(fitScale({ width: 100, height: 100 }, { width: 0, height: 0 })).toBe(1);
  });
});

describe('gaugeRowSize', () => {
  it('fits N gauges across the zone width (minus gaps), capped by height', () => {
    // width path: (900 - 28*2)/3 ≈ 281 → clamped to 280; height 400-50=350 → min(280,350)=280
    expect(gaugeRowSize({ zoneW: 900, zoneH: 400, count: 3, gap: 28 })).toBe(280);
  });
  it('is limited by height when the band is short', () => {
    // height path: 180-50 = 130; width path large → min = 130
    expect(gaugeRowSize({ zoneW: 1200, zoneH: 180, count: 2, gap: 28 })).toBe(130);
  });
  it('clamps to the floor for a tiny zone', () => {
    expect(gaugeRowSize({ zoneW: 50, zoneH: 50, count: 6, gap: 28 })).toBe(96);
  });
  it('defaults to the floor for an unmeasured (zero) box', () => {
    expect(gaugeRowSize({ zoneW: 0, zoneH: 0, count: 1 })).toBe(96);
  });
});
