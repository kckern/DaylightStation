import { screenY, depthScale, POV_CAMERA } from './povProjection.js';

/**
 * The POV camera. Extends the fixed 1/z ground-plane projection (povProjection)
 * with a shiftable horizontal vanishing point (`vanishX`, default 50). The grid
 * canvas AND the DOM avatar overlay both project through this single object, so
 * they never detach and cinematic camera moves apply to everything coherently.
 */
export const BASE_CAMERA = { ...POV_CAMERA, vanishX: 50 };

// Project a ground point to a horizontal screen fraction (0..100 = % width).
// depth t in [0,1] (0 near/bottom, 1 far/horizon); worldX is the near-edge x (0..100).
export function projectX(t, worldX, cam = BASE_CAMERA) {
  const vanishX = Number.isFinite(cam.vanishX) ? cam.vanishX : 50;
  return vanishX + (worldX - vanishX) * depthScale(t, cam);
}

// Vertical screen fraction (0=top, 1=bottom).
export function projectY(t, cam = BASE_CAMERA) {
  return screenY(t, cam);
}
