import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { POV_CAMERA } from '@/modules/Fitness/lib/cycleGame/povProjection.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import { makeSmoothNoise } from '@/modules/Fitness/lib/cycleGame/povNoise.js';
import './PovGrid.scss';

const MINOR_M = 10;        // minor grid line every 10 m
const MAJOR_M = 50;        // major grid line every 50 m
// One DOM line per pooled slot; slot = (m/10) % GRID_SLOTS. A multiple of 50/10=5 so a
// slot's major/minor identity (slot % 5 === 0) is constant → styled statically.
const GRID_SLOTS = 50;     // covers 500 m of road; far-back lines fade in the band fog
const TICK_MS = 1000;      // matches RACE_TICK_MS — the data cadence we interpolate across
const K_TAU_MS = 320;      // zoom-ease time constant: rezooms glide instead of snapping
const FAR_BASE = POV_CAMERA.farFrac; // leader's resting screen-Y (≈0.22 from the top)
const EBB_AMP = 0.05;      // leader ebbs in ~[0.17, 0.27] — never pegged to one row
const ZOOM_NOISE = 0.04;   // ±4% organic zoom breathing

/**
 * POV road grid — a 60fps compositor-only pseudo-3D treadmill. React renders the
 * structure once per tick; a single rAF loop eases the zoom, breathes the camera, and
 * interpolates the leader/riders between ticks, writing translate3d/scaleX/opacity
 * straight to refs. Depth is a 1/z projection (povProjection); the grid is a FIXED
 * 10 m (minor) / 50 m (major) metre scale so motion + zoom read clearly. See README.
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
  // Two decorrelated camera-noise channels, re-seeded per mount so each race ebbs its own way.
  const ebbNoise = useMemo(() => makeSmoothNoise(Math.random() * 1000), []);
  const zoomNoise = useMemo(() => makeSmoothNoise(Math.random() * 1000 + 500), []);

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

      const tSec = nowT / 1000;
      const kFrame = kRef.current * (1 + zoomNoise(tSec) * ZOOM_NOISE);   // subtle zoom breathing
      const cam = { ...POV_CAMERA, farFrac: FAR_BASE + ebbNoise(tSec) * EBB_AMP }; // leader ebb

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
  }, [ebbNoise, zoomNoise]); // both stable (useMemo []) → the loop still mounts once

  return (
    <div className="cg-pov" data-testid="race-pov">
      <svg className="cg-pov__fan" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {movedIds.map((id, idx) => {
          const nearX = laneX(idx);
          const farX = 50 + (nearX - 50) * (1 / POV_CAMERA.depthRatio);
          return (
            <line key={id} x1={nearX} y1={100} x2={farX} y2={POV_CAMERA.farFrac * 100}
              stroke="rgba(255,45,149,0.28)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          );
        })}
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
