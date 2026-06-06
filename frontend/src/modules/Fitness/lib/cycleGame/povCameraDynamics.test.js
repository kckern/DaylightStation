import { describe, it, expect } from 'vitest';
import { stepCameraDynamics, cameraFrom, NEUTRAL_DYNAMICS } from './povCameraDynamics.js';
import { BASE_CAMERA } from './povCamera.js';

const settle = (signals, steps = 400, dt = 16) => {
  let s = NEUTRAL_DYNAMICS;
  for (let i = 0; i < steps; i++) s = stepCameraDynamics(s, signals, dt);
  return s;
};

describe('povCameraDynamics', () => {
  it('starts neutral (no lean, no zoom boost)', () => {
    expect(NEUTRAL_DYNAMICS.vanishX).toBe(50);
    expect(NEUTRAL_DYNAMICS.fovMul).toBe(1);
  });

  it('leans the vanishing point toward the leader lane, bounded', () => {
    const right = settle({ leaderLaneX: 100, accel: 0 });
    expect(right.vanishX).toBeGreaterThan(50);
    expect(right.vanishX).toBeLessThanOrEqual(50 + 12 + 1e-6);
    const left = settle({ leaderLaneX: 0, accel: 0 });
    expect(left.vanishX).toBeLessThan(50);
  });

  it('pulses FOV up on acceleration, bounded, and never below 1', () => {
    const sprint = settle({ leaderLaneX: 50, accel: 100 });
    expect(sprint.fovMul).toBeGreaterThan(1);
    expect(sprint.fovMul).toBeLessThanOrEqual(1.5 + 1e-6);
    const cruise = settle({ leaderLaneX: 50, accel: 0 });
    expect(cruise.fovMul).toBeCloseTo(1, 2);
  });

  it('eases smoothly — one step moves only partway toward target', () => {
    const next = stepCameraDynamics(NEUTRAL_DYNAMICS, { leaderLaneX: 100, accel: 0 }, 16);
    expect(next.vanishX).toBeGreaterThan(50);
    expect(next.vanishX).toBeLessThan(56);
  });

  it('cameraFrom maps dynamics onto a camera (vanishX + depthRatio boost)', () => {
    const cam = cameraFrom({ vanishX: 57, fovMul: 1.2 });
    expect(cam.vanishX).toBe(57);
    expect(cam.depthRatio).toBeCloseTo(BASE_CAMERA.depthRatio * 1.2);
    expect(cam.farFrac).toBe(BASE_CAMERA.farFrac);
  });
});
