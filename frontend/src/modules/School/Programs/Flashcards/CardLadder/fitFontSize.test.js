import { describe, expect, it } from 'vitest';
import { fitFontSize } from './fitFontSize.js';

describe('fitFontSize', () => {
  it('finds the largest size that fits', () => {
    expect(fitFontSize({ measure: (px) => ({ fits: px <= 73 }), min: 20, max: 120 })).toEqual({ px: 73, clamped: false });
  });
  it('clamps at min when nothing fits', () => {
    expect(fitFontSize({ measure: () => ({ fits: false }), min: 20, max: 120 })).toEqual({ px: 20, clamped: true });
  });
  it('max when everything fits', () => {
    expect(fitFontSize({ measure: () => ({ fits: true }), min: 20, max: 120 }).px).toBe(120);
  });
});
