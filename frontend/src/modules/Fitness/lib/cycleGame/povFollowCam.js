/**
 * Axis-aligned bounding box for cameraControls.fitToBox to frame the field.
 *
 * zFar = leaderZ − aheadM (road ahead of the leader, so the leader frames in the
 * top third rather than at the screen edge). zNear = lastZ. If the spread is below
 * minSpanM the box is expanded symmetrically about its midpoint, so a bunched pack
 * does not zoom past the cap (close riders cluster — proximity is highlighted, not
 * stretched). The hard pixel cap is also enforced by cameraControls.minDistance.
 * Coordinates are in metres; leaderZ/lastZ are ≤ 0 (further = more negative).
 * See docs/superpowers/specs/2026-06-06-pov-grid-threejs-camera-controls-design.md
 *
 * @returns {{ min:{x,y,z}, max:{x,y,z} }}
 */
export function povFollowCam({ leaderZ, lastZ, aheadM = 25, minSpanM = 20, roadHalfW = 4, groundBand = 1.5 }) {
  let zFar = leaderZ - aheadM; // most negative
  let zNear = lastZ;           // least negative
  const span = zNear - zFar;
  if (span < minSpanM) {
    const mid = (zNear + zFar) / 2;
    zFar = mid - minSpanM / 2;
    zNear = mid + minSpanM / 2;
  }
  return {
    min: { x: -roadHalfW, y: -groundBand, z: zFar },
    max: { x: roadHalfW, y: groundBand, z: zNear },
  };
}

export default povFollowCam;
