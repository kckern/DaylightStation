/**
 * Fixed-camera ground-plane perspective for the POV road. The scaling/zoom is NOT
 * re-derived here — leaderAnchoredZoom maps metres-behind-leader -> a linear depth
 * coord u in [0,rightPct] (leader near rightPct, near-camera near 0). This module adds
 * only the perspective: a 1/z remap so depth bunches toward the horizon and lanes
 * converge — a real camera, not a leaned CSS plane.
 *
 * Two meaningful constants:
 *   farFrac    — screen-Y (0=top,1=bottom) the leader/far-plane sits at.
 *   depthRatio — zFar/zNear; how hard the perspective bunches (1 = flat, no 3D).
 */
export const POV_CAMERA = {
  rightPct: 0.88,  // leader's linear-depth coord (matches ZOOM_DEFAULTS.rightPct)
  farFrac: 0.10,   // leader/far-plane screen-Y (near the top)
  depthRatio: 6,   // zFar/zNear — perspective strength
  fogFrac: 0.18    // depth t below which far lines fade out (atmosphere)
};

// u in [0,rightPct] -> t in [0,1] (0 near camera, 1 far/leader), clamped.
export function depthT(u, cam = POV_CAMERA) {
  const r = cam.rightPct > 0 ? u / cam.rightPct : 0;
  return r < 0 ? 0 : r > 1 ? 1 : r;
}

// 1/z for depth t, with z = 1 + (depthRatio-1)*t. r=1 at near, 1/depthRatio at far.
export function perspRatio(t, cam = POV_CAMERA) {
  return 1 / (1 + (cam.depthRatio - 1) * t);
}

// Screen-Y fraction (0=top,1=bottom). Linear in r=1/z (correct for a ground plane):
// near (t=0,r=1) -> 1.0; far (t=1,r=1/depthRatio) -> farFrac.
export function screenY(t, cam = POV_CAMERA) {
  const rNear = 1;
  const rFar = perspRatio(1, cam);
  const r = perspRatio(t, cam);
  const f = (r - rFar) / (rNear - rFar);
  return cam.farFrac + (1 - cam.farFrac) * f;
}

// Horizontal scale at depth t — 1/z normalized to 1 at the near edge. Lanes/markers
// shrink with depth; far plane = 1/depthRatio.
export function depthScale(t, cam = POV_CAMERA) {
  return perspRatio(t, cam) / perspRatio(0, cam);
}
