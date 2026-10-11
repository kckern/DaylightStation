import { describe, expect, it } from 'vitest';
import { fitFontPx, fitStaged } from './fitText.js';

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

describe('fitStaged', () => {
  const STAGES = [{ lines: 1, minRatio: 0.75 }, { lines: 2, minRatio: 0.6 }];
  // A text whose width at px is px*k, in a box `width` wide (a crude wrap model).
  const model = (k, width) => (px, lines) => Math.ceil((px * k) / width) <= lines;

  it('a short entry that wraps at full size shrinks a little to one line', () => {
    // 30px needs 2 lines; one line fits from 25px down.
    expect(fitStaged({ maxPx: 30, minPx: 14, stages: STAGES, fitsAt: model(10, 250) })).toBe(25);
  });

  it('a long entry that cannot reach one line takes two lines at the largest size', () => {
    expect(fitStaged({ maxPx: 30, minPx: 14, stages: STAGES, fitsAt: model(20, 250) })).toBe(25);
  });

  it('an entry too long for two lines at the floor gets the floor (and wraps)', () => {
    expect(fitStaged({ maxPx: 30, minPx: 14, stages: STAGES, fitsAt: () => false })).toBe(18);
  });

  it('never goes below minPx', () => {
    expect(fitStaged({ maxPx: 16, minPx: 14, stages: STAGES, fitsAt: () => false })).toBe(14);
  });
});
