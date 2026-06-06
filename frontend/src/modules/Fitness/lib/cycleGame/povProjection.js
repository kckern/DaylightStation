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
  farFrac: 0.22,   // leader/far-plane screen-Y — a comfortable margin from the top so
                   // the forwardmost avatar isn't clipped (was 0.10, which cut it off).
                   // FIXED: the Canvas2D renderer keeps the horizon steady (the grid is
                   // a solid plane, not jello); only vanishX/depthRatio flex (povCamera).
  depthRatio: 6,   // zFar/zNear — perspective strength
  fogFrac: 0.18    // depth t below which far lines fade out (atmosphere)
};

// Smooth Hermite ramp 0→1 across [edge0, edge1]; flat outside. Used for the grid's
// band fog so lines ease in/out at the road edges (no pop when a slot recycles).
export function smoothstep(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Grid-line visibility vs depth t (0 near camera/bottom, 1 far/horizon). Fades IN at
// the horizon (where a new line enters as the leader advances) and OUT at the near
// edge (where it exits) — brightest in the legible mid-field. Both ends → 0 so slot
// recycling at either edge is invisible.
export function bandOpacity(t, cam = POV_CAMERA) {
  const inFar = 1 - smoothstep(0.90, 1.0, t);   // 1 until t=0.90, →0 at the horizon
  const outNear = smoothstep(0.0, cam.fogFrac, t); // 0 at t=0, →1 by the fog depth
  return inFar * outNear;
}

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
