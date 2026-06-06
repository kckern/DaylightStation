import { describe, it, expect } from 'vitest';
import { BASE_CAMERA, projectX, projectY } from './povCamera.js';
import { depthScale, screenY } from './povProjection.js';

describe('povCamera', () => {
  it('leaves the near edge unchanged (depthScale=1 at t=0)', () => {
    expect(projectX(0, 0, BASE_CAMERA)).toBeCloseTo(0);
    expect(projectX(0, 100, BASE_CAMERA)).toBeCloseTo(100);
    expect(projectX(0, 73, BASE_CAMERA)).toBeCloseTo(73);
  });

  it('converges lanes toward the vanishing point with depth', () => {
    const sFar = depthScale(1, BASE_CAMERA);
    expect(projectX(1, 0, BASE_CAMERA)).toBeCloseTo(50 + (0 - 50) * sFar);
    expect(projectX(1, 100, BASE_CAMERA)).toBeCloseTo(50 + (100 - 50) * sFar);
  });

  it('shifts the far convergence when vanishX moves, near edge fixed', () => {
    const cam = { ...BASE_CAMERA, vanishX: 60 };
    expect(projectX(0, 100, cam)).toBeCloseTo(100);
    const sFar = depthScale(1, cam);
    expect(projectX(1, 100, cam)).toBeCloseTo(60 + (100 - 60) * sFar);
  });

  it('projectY runs bottom→horizon', () => {
    expect(projectY(0, BASE_CAMERA)).toBeCloseTo(screenY(0, BASE_CAMERA));
    expect(projectY(1, BASE_CAMERA)).toBeCloseTo(BASE_CAMERA.farFrac);
  });
});
