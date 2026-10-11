import { describe, expect, it } from 'vitest';
import { fitFontPx } from './fitText.js';

describe('fitFontPx', () => {
  it('keeps the maximum when the text already fits', () => {
    expect(fitFontPx({ maxPx: 29, minPx: 16, fits: () => true })).toBe(29);
  });

  it('finds the largest size that fits', () => {
    expect(fitFontPx({ maxPx: 29, minPx: 16, fits: (px) => px <= 21 })).toBe(21);
  });

  it('stops at the floor when nothing fits (the text then wraps further, never clips)', () => {
    expect(fitFontPx({ maxPx: 29, minPx: 16, fits: () => false })).toBe(16);
  });

  it('does not probe more sizes than a binary search needs', () => {
    let probes = 0;
    fitFontPx({ maxPx: 64, minPx: 8, fits: (px) => { probes += 1; return px <= 30; } });
    expect(probes).toBeLessThanOrEqual(7);
  });
});
