import { depthT, screenY, depthScale, POV_CAMERA } from './povProjection.js';

/**
 * Pure per-frame layout for the POV road. Interpolates the leader and each rider
 * between the previous and current tick by `frac`, maps each to a linear depth coord
 * (leader-anchored), then projects to screen via povProjection. The component writes
 * the result straight to style.transform — no React state per frame.
 *
 * Returns:
 *   lineSlots: [{ m, y, scale, t }]   y/scale are 0..1 fractions of the panel
 *   markers:   [{ id, idx, laneX, y, scale, t }]
 */
export function computePovFrame({ lines, riders, leaderPrev, leaderCur, k, frac, cam = POV_CAMERA }) {
  const leader = leaderPrev + (leaderCur - leaderPrev) * (frac || 0);
  const project = (distM, minU) => {
    const u = Math.max(minU, Math.min(cam.rightPct, cam.rightPct - (leader - distM) * k));
    const t = depthT(u, cam);
    return { t, y: screenY(t, cam), scale: depthScale(t, cam) };
  };
  const lineSlots = (lines || []).map((ln) => ({ m: ln.m, ...project(ln.m, 0) }));
  const markers = (riders || []).map((r) => {
    const dist = r.prev + (r.cur - r.prev) * (frac || 0);
    return { id: r.id, idx: r.idx, laneX: r.laneX, ...project(dist, 0.02) };
  });
  return { lineSlots, markers };
}

export default computePovFrame;
