import { describe, it, expect } from 'vitest';
import { computeWarningScrimStyle } from './warningScrimStyle.js';

describe('computeWarningScrimStyle', () => {
  it('is subtle at grace-start (full time remaining)', () => {
    const style = computeWarningScrimStyle(30, 30);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0.08)');
    expect(style.backdropFilter).toBe('blur(0px) grayscale(0.1) sepia(0.1)');
    expect(style.WebkitBackdropFilter).toBe(style.backdropFilter);
  });

  it('is at full intensity at lock (no time remaining)', () => {
    const style = computeWarningScrimStyle(0, 30);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0.82)');
    expect(style.backdropFilter).toBe('blur(7px) grayscale(1) sepia(0.4)');
  });

  it('ease-in: at half time remaining the scrim is well under the linear midpoint', () => {
    // Linear midpoint darkness would be (0.08 + 0.82) / 2 = 0.45.
    // With the ^1.6 ease-in, intensity at 50% remaining is ~0.33, so darkness < 0.45.
    const style = computeWarningScrimStyle(15, 30);
    const alpha = Number(style.backgroundColor.match(/[\d.]+\)$/)[0].replace(')', ''));
    expect(alpha).toBeGreaterThan(0.08);
    expect(alpha).toBeLessThan(0.45);
  });

  it('intensifies monotonically as time runs out', () => {
    const alphaAt = (rem) => Number(
      computeWarningScrimStyle(rem, 30).backgroundColor.match(/[\d.]+\)$/)[0].replace(')', '')
    );
    expect(alphaAt(30)).toBeLessThan(alphaAt(20));
    expect(alphaAt(20)).toBeLessThan(alphaAt(10));
    expect(alphaAt(10)).toBeLessThan(alphaAt(0));
  });

  it('clamps remaining > total to the start intensity', () => {
    expect(computeWarningScrimStyle(45, 30)).toEqual(computeWarningScrimStyle(30, 30));
  });

  it('falls back to the original static scrim when the countdown is unusable', () => {
    const fallback = {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px) grayscale(1) sepia(0.4)',
      WebkitBackdropFilter: 'blur(4px) grayscale(1) sepia(0.4)'
    };
    expect(computeWarningScrimStyle(null, 30)).toEqual(fallback);
    expect(computeWarningScrimStyle(10, 0)).toEqual(fallback);
    expect(computeWarningScrimStyle(10, NaN)).toEqual(fallback);
  });
});
