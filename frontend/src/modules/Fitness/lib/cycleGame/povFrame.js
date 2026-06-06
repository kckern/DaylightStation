import { depthT, screenY, depthScale, bandOpacity, POV_CAMERA } from './povProjection.js';

const lerp = (a, b, f) => a + (b - a) * (f || 0);

/**
 * Pure per-frame layout for the POV road.
 *
 *  - Interpolates the leader between the previous and current tick by `frac`.
 *  - Generates a FIXED-metre grid (minor every `minorM` m, major every `majorM` m) for
 *    the `count` marks nearest-and-behind the leader, projected through `cam` at the
 *    (already-eased) zoom `k`. Each mark keeps a STABLE recycling slot
 *    `(m / minorM) % count`, so a reused DOM line never jumps mid-screen — entry (at the
 *    horizon) and exit (at the near edge) both happen where `bandOpacity` is ~0.
 *    Because `count` is a multiple of `majorM/minorM`, a slot's major/minor identity is
 *    constant (`slot % (majorM/minorM) === 0`), so the component can style it statically.
 *  - Projects each rider marker (leader pins at the far plane → `cam.farFrac`).
 *
 * @returns {{ lineSlots: Array, markers: Array }}
 *   lineSlots: [{ slot, m, major, t, y, scale, opacity }]   y/scale/opacity are 0..1
 *   markers:   [{ id, idx, laneX, t, y, scale }]
 */
export function computePovFrame({
  riders, leaderPrev, leaderCur, k, frac,
  cam = POV_CAMERA, count = 50, minorM = 10, majorM = 50
}) {
  const leader = lerp(leaderPrev, leaderCur, frac);
  const kk = k > 0 && isFinite(k) ? k : 0;
  const majorEvery = Math.max(1, Math.round(majorM / minorM));

  // Grid marks — the `count` fixed-metre lines at/behind the leader. A mark off the road
  // (projects before the near edge or past the leader) is emitted with opacity 0 so its
  // slot stays parked rather than piling up at a clamped edge.
  const lineSlots = [];
  if (kk > 0) {
    const leaderFloor = Math.floor(leader / minorM) * minorM;
    for (let i = 0; i < count; i++) {
      const m = leaderFloor - i * minorM;
      if (m < 0) break; // never draw before the start line
      const u = cam.rightPct - (leader - m) * kk;
      const onRoad = u >= 0 && u <= cam.rightPct + 1e-6;
      const t = depthT(Math.max(0, Math.min(cam.rightPct, u)), cam);
      const slot = (m / minorM) % count;
      lineSlots.push({
        slot,
        m,
        major: slot % majorEvery === 0,
        t,
        y: screenY(t, cam),
        scale: depthScale(t, cam),
        opacity: onRoad ? bandOpacity(t, cam) : 0
      });
    }
  }

  const markers = (riders || []).map((r) => {
    const dist = lerp(r.prev, r.cur, frac);
    const u = Math.max(0.02, Math.min(cam.rightPct, cam.rightPct - (leader - dist) * kk));
    const t = depthT(u, cam);
    return { id: r.id, idx: r.idx, laneX: r.laneX, t, y: screenY(t, cam), scale: depthScale(t, cam) };
  });

  return { lineSlots, markers };
}

export default computePovFrame;
