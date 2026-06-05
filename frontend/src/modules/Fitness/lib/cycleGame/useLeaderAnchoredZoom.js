import { useRef } from 'react';
import { stepZoom, xForDist, pickGridMeters, gridLines, ZOOM_DEFAULTS } from './leaderAnchoredZoom.js';

/**
 * React hook wrapping the leader-anchored spatial zoom. Holds k (px-per-metre) in a
 * ref so it persists across the 1 Hz ticks and only changes on a rezoom — the panels
 * no longer remount each tick, so the ref is stable. Returns the current scale plus
 * helpers to place riders and draw the grid.
 *
 * @param {number[]} distances - each rider's cumulative metres
 * @param {object} [cfg] - overrides for ZOOM_DEFAULTS
 */
export function useLeaderAnchoredZoom(distances, cfg = {}) {
  const kRef = useRef(null);
  const valid = (distances || []).filter((d) => Number.isFinite(d));
  const leaderDist = valid.length ? Math.max(...valid) : 0;
  const lastDist = valid.length ? Math.min(...valid) : 0;

  const k = stepZoom(kRef.current, leaderDist, lastDist, cfg);
  kRef.current = k;

  const gridMeters = pickGridMeters(k);
  const rightPct = (cfg.rightPct ?? ZOOM_DEFAULTS.rightPct);

  return {
    kFrac: k,
    gridMeters,
    leaderDist,
    rightPct,
    // x in [0,1] for a distance, clamped just off the left edge so a rider that
    // briefly overshoots the band before a rezoom doesn't disappear.
    xForDist: (d) => Math.max(0.02, Math.min(rightPct, xForDist(d, leaderDist, k, cfg))),
    lines: gridLines(leaderDist, k, gridMeters, cfg)
  };
}
