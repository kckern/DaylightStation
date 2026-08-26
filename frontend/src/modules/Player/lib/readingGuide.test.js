import { describe, it, expect } from 'vitest';
import { computeReadingGuideTop } from './readingGuide.js';

describe('computeReadingGuideTop', () => {
  const base = { narratableHeight: 2000, yOffset: 0, panelHeight: 600, markerHeight: 28 };

  it('starts at the top of the panel at p=0', () => {
    expect(computeReadingGuideTop({ ...base, progressFraction: 0 })).toBe(0);
  });

  it('tracks p * narratableHeight - yOffset in panel coordinates', () => {
    // p=0.1 → narrated line at 200px of content, no scroll yet → 200px in panel
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.1 })).toBe(200);
    // same p, content scrolled 150px → 50px in panel
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.1, yOffset: 150 })).toBe(50);
  });

  it('clamps to the panel: never above 0, never past panelHeight - markerHeight', () => {
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.1, yOffset: 500 })).toBe(0);
    expect(computeReadingGuideTop({ ...base, progressFraction: 1 })).toBe(600 - 28);
  });

  it('clamps progress fraction outside 0..1', () => {
    expect(computeReadingGuideTop({ ...base, progressFraction: -0.5 })).toBe(0);
    expect(computeReadingGuideTop({ ...base, progressFraction: 1.5 })).toBe(600 - 28);
  });

  it('treats a missing yOffset as 0', () => {
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.25, yOffset: undefined })).toBe(500);
  });

  it('returns null when the geometry is unplottable', () => {
    expect(computeReadingGuideTop({ ...base, progressFraction: NaN })).toBeNull();
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.5, narratableHeight: 0 })).toBeNull();
    expect(computeReadingGuideTop({ ...base, progressFraction: 0.5, panelHeight: 0 })).toBeNull();
  });
});
