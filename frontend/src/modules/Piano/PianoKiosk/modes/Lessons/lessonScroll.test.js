import { describe, it, expect } from 'vitest';
import { computeTargetScrollLeft, clampScrollLeft } from './lessonScroll.js';

describe('clampScrollLeft', () => {
  it('clamps to the [0, maxScroll] range', () => {
    expect(clampScrollLeft(-50, 1000)).toBe(0);
    expect(clampScrollLeft(2000, 1000)).toBe(1000);
    expect(clampScrollLeft(300, 1000)).toBe(300);
  });
  it('never returns negative when content is narrower than the viewport (maxScroll <= 0)', () => {
    expect(clampScrollLeft(300, 0)).toBe(0);
    expect(clampScrollLeft(300, -10)).toBe(0);
  });
});

describe('computeTargetScrollLeft', () => {
  // Given a note whose left edge is at noteLeft within the scroll content,
  // we want that note pinned restFraction (e.g. 0.10) from the left of the viewport.
  const base = { viewportWidth: 1000, contentWidth: 5000, restFraction: 0.1 };

  it('positions the note restFraction from the left edge', () => {
    // note at content-x 600, want it at 100px from left => scrollLeft 500
    expect(computeTargetScrollLeft({ ...base, noteLeft: 600 })).toBe(500);
  });

  it('clamps at the start (cannot scroll past 0)', () => {
    // note near the very start: desired scrollLeft would be negative
    expect(computeTargetScrollLeft({ ...base, noteLeft: 50 })).toBe(0);
  });

  it('clamps at the end (cannot scroll past maxScroll = contentWidth - viewportWidth)', () => {
    // note near the very end: desired scrollLeft exceeds maxScroll (4000)
    expect(computeTargetScrollLeft({ ...base, noteLeft: 4990 })).toBe(4000);
  });

  it('returns 0 for degenerate geometry (zero viewport)', () => {
    expect(computeTargetScrollLeft({ ...base, viewportWidth: 0, noteLeft: 600 })).toBe(0);
  });
});
