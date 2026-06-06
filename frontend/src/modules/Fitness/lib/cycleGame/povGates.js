import { depthT, screenY, depthScale, bandOpacity, POV_CAMERA } from './povProjection.js';

/**
 * Lap-gate slots for the POV road.
 *
 * A gate sits at a fixed road distance (`N × lapLengthM`); every rider passes
 * through it when their own distance crosses that mark. Because the view is
 * leader-anchored (leader at the horizon, camera trailing), only gates BEHIND the
 * leader and still on the visible road are drawn — they recede toward the camera
 * as the leader pulls away. The finish (`finishM`, a distance race) is added too,
 * but since it's ahead of the leader it projects off-road (opacity 0) until the
 * leader reaches it.
 *
 * Each gate is projected exactly like a metre truss, so it lines up with the grid
 * and the avatars (same camera).
 *
 * @param {number} leader - interpolated leader distance (m)
 * @param {number} k - width-fraction per metre (zoom)
 * @param {object} cam - camera (rightPct, depthRatio, farFrac, ...)
 * @param {{lapLengthM:number, finishM?:number|null}} opts
 * @returns {Array<{ d:number, lap:number|null, isFinish:boolean, t:number, y:number, scale:number, opacity:number }>}
 */
export function computeGates(leader, k, cam = POV_CAMERA, { lapLengthM = 0, finishM = null } = {}) {
  const kk = k > 0 && isFinite(k) ? k : 0;
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (kk <= 0 || lap <= 0 || !(leader >= 0)) return [];

  const nearDist = leader - cam.rightPct / kk; // road distance at the near edge (u=0)
  const project = (d, lapNum, isFinish) => {
    const u = cam.rightPct - (leader - d) * kk;
    const onRoad = u >= 0 && u <= cam.rightPct + 1e-6;
    const t = depthT(Math.max(0, Math.min(cam.rightPct, u)), cam);
    return {
      d, lap: lapNum, isFinish,
      t, y: screenY(t, cam), scale: depthScale(t, cam),
      opacity: onRoad ? bandOpacity(t, cam) : 0
    };
  };

  const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
  const gates = [];

  // Lap multiples on the visible road behind the leader (never past the finish).
  const firstN = Math.max(1, Math.ceil(nearDist / lap));
  for (let n = firstN; n * lap <= leader + 1e-6; n++) {
    const d = n * lap;
    if (d > finishCap + 1e-6) break;
    if (Math.abs(d - finishCap) < 1e-6) continue; // the finish draws as its own gate
    gates.push(project(d, n, false));
  }

  // Finish gate (distance race). Off-road (opacity 0) until the leader reaches it.
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push(project(finishM, null, true));
  }

  return gates;
}

export default computeGates;
