import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { POV_CAMERA } from '@/modules/Fitness/lib/cycleGame/povProjection.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import { computeGridRails } from '@/modules/Fitness/lib/cycleGame/povRails.js';
import './PovGrid.scss';

const MINOR_M = 10;        // minor grid line every 10 m
const MAJOR_M = 50;        // major grid line every 50 m
// One DOM line per pooled slot; slot = (m/10) % GRID_SLOTS. A multiple of 50/10=5 so a
// slot's major/minor identity (slot % 5 === 0) is constant → styled statically.
const GRID_SLOTS = 50;     // covers 500 m of road; far-back lines fade in the band fog
const TICK_MS = 1000;      // matches RACE_TICK_MS — the data cadence we interpolate across
const K_TAU_MS = 320;      // zoom-ease time constant: rezooms glide instead of snapping
const VLINES = 9;          // fixed vertical gridlines (road edges + interior), camera-locked

// The longitudinal rails are STATIC: a fixed camera ⇒ a solid road grid (not jello).
// Computed once at module load; the rAF loop never touches them.
const GRID_RAILS = computeGridRails(POV_CAMERA, VLINES);

/**
 * POV road grid — a 60fps compositor-only pseudo-3D treadmill. React renders the
 * structure once per tick; a single rAF loop eases the rezoom and interpolates the
 * leader/riders between ticks, writing translate3d/scaleX/opacity straight to refs.
 * Depth is a 1/z projection (povProjection) through a FIXED camera, so the road grid
 * is SOLID (not jello): fixed 10 m / 50 m metre trusses crossed by fixed vertical
 * gridlines. Only riders + trusses move along the static grid. See README.
 */
export default function PovGrid({ riderIds, riders, riderLive = {} }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  // Never show a rider who hasn't moved at all (still 0 m): a stuck / did-not-start
  // rider would anchor the leader-anchored zoom at 0 m and compress everyone else.
  const movedIds = riderIds.filter((id) => distOf(id) > 0);
  // Stable per-rider colour keyed off the FULL field index (matches chart / oval).
  const colorOf = (id) => LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length];
  const zoom = useLeaderAnchoredZoom(movedIds.map(distOf), { maxLines: GRID_SLOTS });
  const laneX = (idx) => (movedIds.length <= 1 ? 50 : 12 + idx * (76 / (movedIds.length - 1)));

  const tickRef = useRef({ leaderPrev: 0, leaderCur: 0, kTarget: 0, riders: [], tickAt: 0 });
  const kRef = useRef(null);          // eased zoom (glides toward tickRef.kTarget)
  const lineEls = useRef([]);
  const markerEls = useRef({});
  const prevDistRef = useRef({});

  // Capture each new tick's targets (roll cur->prev). Only advances on a real data
  // change, so a stray re-render doesn't reset the interpolation clock.
  useEffect(() => {
    const t = tickRef.current;
    if (zoom.leaderDist === t.leaderCur && Object.keys(prevDistRef.current).length === movedIds.length) return;
    const now = performance.now();
    const prev = prevDistRef.current;
    const ridersFrame = movedIds.map((id, idx) => ({
      id, idx, laneX: laneX(idx),
      prev: Number.isFinite(prev[id]) ? prev[id] : distOf(id),
      cur: distOf(id)
    }));
    tickRef.current = {
      leaderPrev: Number.isFinite(t.leaderCur) && t.leaderCur > 0 ? t.leaderCur : zoom.leaderDist,
      leaderCur: zoom.leaderDist,
      kTarget: zoom.kFrac,
      riders: ridersFrame,
      tickAt: now
    };
    const next = {}; movedIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // The 60fps loop — mounts once, reads refs, writes transforms. No React state per frame.
  useEffect(() => {
    let raf;
    let lastT = performance.now();
    const draw = () => {
      const nowT = performance.now();
      const dt = Math.min(64, nowT - lastT); lastT = nowT;
      const t = tickRef.current;

      // Ease the zoom toward this tick's target k (frame-rate-independent exponential),
      // so a rezoom glides — riders and grid both slide, never jump.
      const target = t.kTarget;
      if (!(kRef.current > 0)) kRef.current = target;
      else if (target > 0) kRef.current += (target - kRef.current) * (1 - Math.exp(-dt / K_TAU_MS));

      // Fixed camera + un-noised zoom ⇒ the grid is SOLID. The only motion left is real:
      // riders advancing (interpolated below) and the eased rezoom glide (kRef).
      const kFrame = kRef.current;
      const cam = POV_CAMERA;

      const frac = tickFraction(nowT, t.tickAt, TICK_MS);
      const { lineSlots, markers } = computePovFrame({
        riders: t.riders, leaderPrev: t.leaderPrev, leaderCur: t.leaderCur,
        k: kFrame, frac, cam, count: GRID_SLOTS, minorM: MINOR_M, majorM: MAJOR_M
      });

      // Park every slot, then write the active marks (stable slot per world-line).
      for (let i = 0; i < GRID_SLOTS; i++) { const el = lineEls.current[i]; if (el) el.style.opacity = '0'; }
      for (const s of lineSlots) {
        const el = lineEls.current[s.slot];
        if (!el) continue;
        el.style.transform = `translate3d(0, ${(s.y * 100).toFixed(3)}cqh, 0) scaleX(${s.scale.toFixed(4)})`;
        el.style.opacity = (s.opacity * (s.major ? 0.95 : 0.45)).toFixed(3);
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
  }, []); // mounts once; the loop reads refs and writes transforms — no React state per frame

  return (
    <div className="cg-pov" data-testid="race-pov">
      {/* Longitudinal road gridlines — a FIXED, camera-locked grid (solid, not per-rider).
          Static for a fixed camera, so they're rendered once and never animated. */}
      <svg className="cg-pov__fan" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="cgPovRail" gradientUnits="userSpaceOnUse"
            x1="0" y1={POV_CAMERA.farFrac * 100} x2="0" y2="100">
            <stop offset="0" stopColor="#21e6ff" stopOpacity="0.04" />
            <stop offset="1" stopColor="#21e6ff" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {GRID_RAILS.map((r) => (
          <line key={r.i} className="cg-pov__rail"
            x1={r.nearX} y1={r.yNear} x2={r.farX} y2={r.yFar}
            stroke="url(#cgPovRail)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      <div className="cg-pov__grid" data-testid="pov-grid" aria-hidden="true">
        {Array.from({ length: GRID_SLOTS }, (_, i) => (
          <div key={i} style={{ opacity: 0 }}
            className={`cg-pov__hline cg-pov__hline--${i % (MAJOR_M / MINOR_M) === 0 ? 'major' : 'minor'}`}
            ref={(el) => { lineEls.current[i] = el; }} />
        ))}
      </div>

      {movedIds.map((id) => {
        const color = colorOf(id);
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
