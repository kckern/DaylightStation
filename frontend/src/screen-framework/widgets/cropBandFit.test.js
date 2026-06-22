import { describe, it, expect } from 'vitest';
import { openingAspect, cropBandFit } from './artModes.js';

const FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };

describe('openingAspect', () => {
  it('full window is 16:9', () => {
    expect(openingAspect({ frame: FRAME, fullWindow: true })).toBeCloseTo(16 / 9, 5);
  });
  it('framed opening is wider than 16:9 (~2:1)', () => {
    const ar = openingAspect({ frame: FRAME, fullWindow: false });
    expect(ar).toBeGreaterThan(1.9);
    expect(ar).toBeLessThan(2.1);
  });
});

describe('cropBandFit', () => {
  it('a band needing zoom scales up and offsets to the band top', () => {
    const fit = cropBandFit({ top: 25, bottom: 25 }, 1.0, 2.0);
    // bh = .5 → s = max(1, 1.0/(2.0*0.5)) = max(1,1) = 1 → no zoom
    expect(fit.scale).toBeCloseTo(1, 5);
    expect(fit.transform).toContain('scale(1');
  });
  it('a thin band zooms in (scale > 1) and centers horizontally', () => {
    const fit = cropBandFit({ top: 40, bottom: 40 }, 1.0, 2.0); // bh=.2 → s=1/(2*.2)=2.5
    expect(fit.scale).toBeCloseTo(2.5, 4);
    expect(fit.transform).toMatch(/translate\(-75\.?0*%, -100\.?0*%\) scale\(2\.5/);
  });
  it('full-frame band on a wide source is a near no-op (scale 1, no offset)', () => {
    const fit = cropBandFit({ top: 0, bottom: 0 }, 2.0, 2.0);
    expect(fit.scale).toBeCloseTo(1, 5);
    expect(fit.transform).toBe('translate(-0%, -0%) scale(1)');
  });
});
