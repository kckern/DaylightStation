import { describe, it, expect } from 'vitest';
import { POV_CAMERA, depthT, perspRatio, screenY, depthScale, bandOpacity } from './povProjection.js';

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

  it('rests the leader in the top third (headroom above for the road ahead)', () => {
    expect(screenY(1)).toBeCloseTo(0.30, 2);     // leader at ~30%, not the very top
    expect(screenY(1)).toBeLessThan(0.35);
    expect(screenY(1)).toBeGreaterThan(0.25);
  });

  it('projects road AHEAD of the leader (t>1) above the leader line, toward the horizon', () => {
    expect(screenY(2)).toBeLessThan(screenY(1));  // further ahead → higher on screen
    expect(screenY(4)).toBeLessThan(screenY(2));
    expect(screenY(1.5)).toBeGreaterThan(POV_CAMERA.farFrac - 0.2); // still in the headroom band
  });

  it('bandOpacity keeps the leader line visible and fades approaching the far horizon (aheadT)', () => {
    expect(bandOpacity(1)).toBeGreaterThan(0.5);                 // leader area is bright now
    expect(bandOpacity(POV_CAMERA.aheadT)).toBeCloseTo(0, 2);    // dissolves at the horizon
    expect(bandOpacity(0.5)).toBeGreaterThan(bandOpacity(POV_CAMERA.aheadT - 0.2));
  });
});
