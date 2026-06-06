import { describe, it, expect } from 'vitest';
import { computeGridRails } from './povRails.js';
import { POV_CAMERA, screenY, depthScale } from './povProjection.js';

describe('computeGridRails', () => {
  it('returns the requested number of rails', () => {
    expect(computeGridRails(POV_CAMERA, 9)).toHaveLength(9);
    expect(computeGridRails(POV_CAMERA, 6)).toHaveLength(6);
  });

  it('spans the full near road width, both edges included', () => {
    const r = computeGridRails(POV_CAMERA, 9);
    expect(r[0].nearX).toBe(0);
    expect(r[r.length - 1].nearX).toBe(100);
  });

  it('is evenly spaced at the near edge', () => {
    const r = computeGridRails(POV_CAMERA, 9);
    for (let i = 1; i < r.length; i++) {
      expect(r[i].nearX - r[i - 1].nearX).toBeCloseTo(100 / 8);
    }
  });

  it('converges toward the vanishing band with depth (|farX-50| = |nearX-50| * sFar)', () => {
    const r = computeGridRails(POV_CAMERA, 9);
    const sFar = depthScale(1, POV_CAMERA);
    r.forEach((rail) => {
      expect(Math.abs(rail.farX - 50)).toBeCloseTo(Math.abs(rail.nearX - 50) * sFar);
      if (rail.nearX !== 50) {
        expect(Math.abs(rail.farX - 50)).toBeLessThan(Math.abs(rail.nearX - 50));
      }
    });
  });

  it('runs from the near edge (bottom) to the horizon (farFrac)', () => {
    const rail = computeGridRails(POV_CAMERA, 9)[0];
    expect(rail.yNear).toBeCloseTo(screenY(0, POV_CAMERA) * 100); // 100 = bottom
    expect(rail.yFar).toBeCloseTo(POV_CAMERA.farFrac * 100);       // horizon
  });

  it('keeps the centre rail straight when count is odd', () => {
    const mid = computeGridRails(POV_CAMERA, 9)[4]; // nearX 50
    expect(mid.nearX).toBe(50);
    expect(mid.farX).toBeCloseTo(50);
  });

  it('is identical on every call — a fixed camera yields a static, solid grid', () => {
    expect(computeGridRails(POV_CAMERA, 9)).toEqual(computeGridRails(POV_CAMERA, 9));
  });
});
