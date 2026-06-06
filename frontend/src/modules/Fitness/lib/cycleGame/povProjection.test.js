import { describe, it, expect } from 'vitest';
import { POV_CAMERA, depthT, perspRatio, screenY, depthScale } from './povProjection.js';

describe('povProjection (1/z ground-plane camera)', () => {
  it('depthT normalizes u in [0,rightPct] to t in [0,1] and clamps', () => {
    expect(depthT(0)).toBeCloseTo(0, 5);
    expect(depthT(POV_CAMERA.rightPct)).toBeCloseTo(1, 5);
    expect(depthT(2 * POV_CAMERA.rightPct)).toBe(1);
    expect(depthT(-1)).toBe(0);
  });
  it('screenY puts the near edge at the bottom and the far plane near the top', () => {
    expect(screenY(0)).toBeCloseTo(1, 5);
    expect(screenY(1)).toBeCloseTo(POV_CAMERA.farFrac, 5);
  });
  it('screenY is monotonic and bunches toward the far plane', () => {
    expect(screenY(0.4)).toBeGreaterThan(screenY(0.6));
    const nearStep = screenY(0) - screenY(0.1);
    const farStep = screenY(0.9) - screenY(1);
    expect(nearStep).toBeGreaterThan(farStep);
  });
  it('depthScale shrinks lanes/markers with depth (1 near, 1/depthRatio far)', () => {
    expect(depthScale(0)).toBeCloseTo(1, 5);
    expect(depthScale(1)).toBeCloseTo(1 / POV_CAMERA.depthRatio, 5);
    expect(depthScale(0.3)).toBeGreaterThan(depthScale(0.7));
  });
  it('perspRatio is 1/z with z = 1 + (depthRatio-1)*t', () => {
    expect(perspRatio(0)).toBeCloseTo(1, 5);
    expect(perspRatio(1)).toBeCloseTo(1 / POV_CAMERA.depthRatio, 5);
  });
});
