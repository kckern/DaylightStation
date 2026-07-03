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

/**
 * Horizon leader-chip hysteresis (audit C5). Even gap-compressed, a very large
 * TRUE gap should surface a fixed-size "LEADER +312 m" plate pinned at the
 * horizon so the trailing rider always knows the real gap. To avoid flicker at
 * the boundary we hysteresis it: show once the true gap exceeds `showAtM`, keep
 * showing until it drops below `showAtM * hideFactor`. Pure — unit-tested.
 *
 * @param {number} gapM        true leader-vs-anchor gap in metres
 * @param {boolean} wasShown   whether the chip is currently shown
 * @returns {{ show:boolean, gapM:number, text:(string|null) }}
 */
export function horizonChipState({ gapM = 0, wasShown = false, showAtM = 120, hideFactor = 0.9 }) {
  const g = Math.max(0, Number(gapM) || 0);
  const hideAtM = showAtM * hideFactor;
  const show = wasShown ? g > hideAtM : g > showAtM;
  return { show, gapM: Math.round(g), text: show ? `LEADER +${Math.round(g)} m` : null };
}

export default povFollowCam;
