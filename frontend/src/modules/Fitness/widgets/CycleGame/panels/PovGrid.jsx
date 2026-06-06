import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { POV_CAMERA } from '@/modules/Fitness/lib/cycleGame/povProjection.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import './PovGrid.scss';

const MAX_LINES = 24;   // recycled hline slot pool (keyed by slot, never remounts)
const TICK_MS = 1000;   // matches RACE_TICK_MS — the data cadence we interpolate across

/**
 * POV road grid — a 60fps compositor-only pseudo-3D treadmill. React renders the
 * structure once per tick; a single rAF loop interpolates the leader/riders between
 * ticks (engine-time, self-correcting) and writes translate3d/scaleX/opacity straight
 * to refs. Depth is a 1/z projection (povProjection), NOT a CSS perspective — nothing
 * repaints through a 3D matrix. See PovGrid.README.md.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  const zoom = useLeaderAnchoredZoom(riderIds.map(distOf), { maxLines: MAX_LINES });
  const laneX = (idx) => (riderIds.length <= 1 ? 50 : 12 + idx * (76 / (riderIds.length - 1)));

  const tickRef = useRef({ leaderPrev: 0, leaderCur: 0, k: 0, lines: [], riders: [], tickAt: 0 });
  const lineEls = useRef([]);
  const markerEls = useRef({});
  const prevDistRef = useRef({});

  // Capture each new tick's targets (roll cur->prev). Only advances on a real data
  // change, so a stray re-render doesn't reset the interpolation clock.
  useEffect(() => {
    const t = tickRef.current;
    if (zoom.leaderDist === t.leaderCur && Object.keys(prevDistRef.current).length === riderIds.length) return;
    const now = performance.now();
    const prev = prevDistRef.current;
    const ridersFrame = riderIds.map((id, idx) => ({
      id, idx, laneX: laneX(idx),
      prev: Number.isFinite(prev[id]) ? prev[id] : distOf(id),
      cur: distOf(id)
    }));
    tickRef.current = {
      leaderPrev: Number.isFinite(t.leaderCur) && t.leaderCur > 0 ? t.leaderCur : zoom.leaderDist,
      leaderCur: zoom.leaderDist,
      k: zoom.kFrac,
      lines: zoom.lines.slice(0, MAX_LINES),
      riders: ridersFrame,
      tickAt: now
    };
    const next = {}; riderIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // The 60fps loop — mounts once, reads refs, writes transforms. No React state per frame.
  useEffect(() => {
    let raf;
    const draw = () => {
      const t = tickRef.current;
      const frac = tickFraction(performance.now(), t.tickAt, TICK_MS);
      const { lineSlots, markers } = computePovFrame({
        lines: t.lines, riders: t.riders,
        leaderPrev: t.leaderPrev, leaderCur: t.leaderCur, k: t.k, frac
      });
      for (let i = 0; i < MAX_LINES; i++) {
        const el = lineEls.current[i];
        if (!el) continue;
        const s = lineSlots[i];
        if (!s) { el.style.opacity = '0'; continue; }
        el.style.transform = `translate3d(0, ${(s.y * 100).toFixed(3)}cqh, 0) scaleX(${s.scale.toFixed(4)})`;
        el.style.opacity = (Math.max(0, Math.min(1, (s.t - POV_CAMERA.fogFrac) / (1 - POV_CAMERA.fogFrac))) * 0.5 + 0.15).toFixed(3);
      }
      markers.forEach((m) => {
        const el = markerEls.current[m.id];
        if (!el) return;
        const x = 50 + (m.laneX - 50) * m.scale;   // lanes converge toward centre with depth
        el.style.transform =
          `translate3d(${x.toFixed(2)}cqw, ${(m.y * 100).toFixed(3)}cqh, 0) translate(-50%, -50%) scale(${(0.55 + 0.45 * m.scale).toFixed(3)})`;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cg-pov" data-testid="race-pov">
      <svg className="cg-pov__fan" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {riderIds.map((id, idx) => {
          const nearX = laneX(idx);
          const farX = 50 + (nearX - 50) * (1 / POV_CAMERA.depthRatio);
          return (
            <line key={id} x1={nearX} y1={100} x2={farX} y2={POV_CAMERA.farFrac * 100}
              stroke="rgba(255,45,149,0.28)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          );
        })}
      </svg>

      <div className="cg-pov__grid" data-testid="pov-grid" aria-hidden="true">
        {Array.from({ length: MAX_LINES }, (_, i) => (
          <div key={i} className="cg-pov__hline" style={{ opacity: 0 }}
            ref={(el) => { lineEls.current[i] = el; }} />
        ))}
      </div>

      {riderIds.map((id, idx) => {
        const color = LINE_COLORS[idx % LINE_COLORS.length];
        const isGhost = !!riders[id]?.isGhost;
        const live = riderLive[id] || {};
        return (
          <div key={id} className={`cg-pov__marker${isGhost ? ' is-ghost' : ''}`} data-testid="pov-marker"
            ref={(el) => { markerEls.current[id] = el; }} style={{ '--cg-pov-color': color }}>
            <CircularUserAvatar name={riders[id]?.displayName} avatarSrc={live.avatarSrc}
              heartRate={live.heartRate} zoneId={live.zoneId} zoneColor={live.zoneColor || color}
              size={44} showGauge={false} showIndicator={false} />
            <span className="cg-pov__dist">{formatDistance(distOf(id))}</span>
          </div>
        );
      })}
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object
};
