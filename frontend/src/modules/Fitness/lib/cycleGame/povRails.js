import { screenY, depthScale, POV_CAMERA } from './povProjection.js';

/**
 * Fixed vertical grid rails for the POV road.
 *
 * `count` evenly-spaced lines across the full near-edge road width (0..100), each
 * projected from the near edge (bottom) to the vanishing point at the horizon. These
 * are the longitudinal counterpart to the metre trusses: together they form the road
 * grid.
 *
 * The camera is FIXED here on purpose — the road is a SOLID grid, not a deforming
 * "jello" plane. (The camera may still breathe elsewhere, but the grid must not.) So
 * the rails are computed once and never animate: only riders + metre trusses move.
 *
 * @param {object} cam - projection camera (POV_CAMERA)
 * @param {number} count - number of vertical gridlines (edges included)
 * @returns {Array<{ i:number, nearX:number, farX:number, yNear:number, yFar:number }>}
 *   screen-space coords: x in [0,100] (% width), y in [0,100] (% height, 0 = top/horizon).
 */
export function computeGridRails(cam = POV_CAMERA, count = 9) {
  const n = Math.max(2, Math.round(count));
  const yNear = screenY(0, cam) * 100;   // near edge → bottom
  const yFar = screenY(1, cam) * 100;    // far plane → horizon (farFrac)
  const sFar = depthScale(1, cam);       // horizontal convergence at the horizon (= 1/depthRatio)
  const rails = [];
  for (let i = 0; i < n; i++) {
    const nearX = (i / (n - 1)) * 100;          // 0..100 across the near road edge
    const farX = 50 + (nearX - 50) * sFar;      // converge toward centre with depth
    rails.push({ i, nearX, farX, yNear, yFar });
  }
  return rails;
}

export default computeGridRails;
