import { screenY, depthScale, bandOpacity, POV_CAMERA } from './povProjection.js';

/**
 * Lap-gate slots for the POV road.
 *
 * A gate sits at a fixed road distance (`N × lapLengthM`); every rider passes
 * through it when their own distance crosses that mark. Gates are emitted across
 * the whole visible window — behind the leader (already-passed laps, receding
 * toward the camera) AND ahead of the leader (upcoming laps + the finish, in the
 * headroom above), bounded by the camera's `aheadT`. Each is projected exactly
 * like a metre truss, so it lines up with the grid and the avatars.
 *
 * @param {number} leader - interpolated leader distance (m)
 * @param {number} k - width-fraction per metre (zoom)
 * @param {object} cam - camera (rightPct, depthRatio, farFrac, aheadT, ...)
 * @param {{lapLengthM:number, finishM?:number|null}} opts
 * @returns {Array<{ d:number, lap:number|null, isFinish:boolean, t:number, y:number, scale:number, opacity:number }>}
 */
export function computeGates(leader, k, cam = POV_CAMERA, { lapLengthM = 0, finishM = null } = {}) {
  const kk = k > 0 && isFinite(k) ? k : 0;
  const lap = Number.isFinite(lapLengthM) && lapLengthM > 0 ? lapLengthM : 0;
  if (kk <= 0 || lap <= 0 || !(leader >= 0)) return [];

  const aheadT = Number.isFinite(cam.aheadT) ? cam.aheadT : 1;
  // Leader depth-anchor (see povFrame): the camera lowers it when the field is bunched.
  const leaderU = Number.isFinite(cam.leaderU) ? cam.leaderU : cam.rightPct;
  const nearDist = leader - leaderU / kk;                            // road distance at the near edge
  const aheadMaxM = leader + Math.max(0, aheadT * cam.rightPct - leaderU) / kk; // furthest visible ahead

  const project = (d, lapNum, isFinish) => {
    const u = leaderU - (leader - d) * kk;
    const t = u / cam.rightPct;                          // unclamped (t>1 is ahead of the leader)
    const onRoad = u >= 0 && t <= aheadT + 1e-6;
    return {
      d, lap: lapNum, isFinish,
      t, y: screenY(t, cam), scale: depthScale(t, cam),
      opacity: onRoad ? bandOpacity(t, cam) : 0
    };
  };

  const finishCap = Number.isFinite(finishM) && finishM > 0 ? finishM : Infinity;
  const gates = [];

  // Lap multiples across the visible window (behind + ahead), never past the finish.
  const lastM = Math.min(aheadMaxM, finishCap);
  const firstN = Math.max(1, Math.ceil(nearDist / lap));
  for (let n = firstN; n * lap <= lastM + 1e-6; n++) {
    const d = n * lap;
    if (Math.abs(d - finishCap) < 1e-6) continue; // the finish draws as its own gate
    gates.push(project(d, n, false));
  }

  // Finish gate (distance race) — now visible in the headroom as the leader nears it.
  if (Number.isFinite(finishM) && finishM > 0) {
    gates.push(project(finishM, null, true));
  }

  return gates;
}

export default computeGates;
