import { describe, it, expect } from 'vitest';
import { computeStudyDims } from './studyLayout.js';

describe('computeStudyDims', () => {
  it('reserves the configured footer share and clamps video height', () => {
    const { videoH, footerHeight } = computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 0.2 });
    expect(videoH).toBe(864);        // 1080 * 0.8
    expect(footerHeight).toBe(216);  // 1080 * 0.2
  });

  it('derives width from the clamped height at 16:9', () => {
    const { videoW } = computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 0.2 });
    expect(videoW).toBe(1536);       // 864 * 16/9
  });

  it('clamps width to the viewport when height-derived width would overflow', () => {
    // A tall/narrow viewport: 864*16/9 = 1536 exceeds 1000, so width wins and
    // height is re-derived from it.
    const { videoW, videoH } = computeStudyDims({ totalW: 1000, totalH: 1080, footerRatio: 0.2 });
    expect(videoW).toBe(1000);
    expect(videoH).toBe(563);        // round(1000 * 9/16)
  });

  it('uses the full width — no sidebar is reserved in study mode', () => {
    const { videoW } = computeStudyDims({ totalW: 1280, totalH: 720, footerRatio: 0.2 });
    expect(videoW).toBe(1024);       // 576 * 16/9, well under 1280
  });

  it('falls back to a 0.2 ratio when given a nonsense value', () => {
    expect(computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: null }).footerHeight).toBe(216);
    expect(computeStudyDims({ totalW: 1920, totalH: 1080, footerRatio: 5 }).footerHeight).toBe(216);
  });

  it('returns zeros for a zero-sized viewport rather than NaN', () => {
    expect(computeStudyDims({ totalW: 0, totalH: 0, footerRatio: 0.2 }))
      .toEqual({ videoW: 0, videoH: 0, footerHeight: 0 });
  });
});
