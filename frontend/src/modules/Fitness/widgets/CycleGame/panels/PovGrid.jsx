import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CircularUserAvatar from '@/modules/Fitness/components/CircularUserAvatar.jsx';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { useLeaderAnchoredZoom } from '@/modules/Fitness/lib/cycleGame/useLeaderAnchoredZoom.js';
import { computePovFrame } from '@/modules/Fitness/lib/cycleGame/povFrame.js';
import { tickFraction } from '@/modules/Fitness/lib/cycleGame/tickFraction.js';
import { computeGridRails } from '@/modules/Fitness/lib/cycleGame/povRails.js';
import { BASE_CAMERA } from '@/modules/Fitness/lib/cycleGame/povCamera.js';
import { stepCameraDynamics, cameraFrom, NEUTRAL_DYNAMICS } from '@/modules/Fitness/lib/cycleGame/povCameraDynamics.js';
import { drawScene } from '@/modules/Fitness/lib/cycleGame/povCanvasScene.js';
import { computeGates } from '@/modules/Fitness/lib/cycleGame/povGates.js';
import getLogger from '@/lib/logging/Logger.js';
import './PovGrid.scss';

const MINOR_M = 1;         // minor metre mark every 1 m
const MAJOR_M = 10;        // major every 10 m
const GRID_SLOTS = 200;    // metre-mark count (covers 200 m of road at 1 m spacing;
                           // a multiple of MAJOR_M/MINOR_M=10 so major identity stays exact.
                           // off-road/fogged marks are skipped in drawScene, so the count is cheap)
const TICK_MS = 1000;      // matches RACE_TICK_MS — the 1 Hz data cadence
const K_TAU_MS = 320;      // zoom-ease time constant
const VLINES = 9;          // fixed vertical gridlines (road edges + interior)

// Leader-anchored zoom anchors (PovGrid-only override): last place rests low on screen
// (≈ bottom 20%) so the field fills the frame instead of crowding the top. minGapM is
// lowered so an early bunched field still spreads down rather than piling at the leader.
const ZOOM_CFG = { maxLines: GRID_SLOTS, homePct: 0.06, lowPct: 0.02, highPct: 0.18, minGapM: 4 };

// Static near-edge x positions for the longitudinal rails (camera reprojects per frame).
const RAILS_X = computeGridRails(BASE_CAMERA, VLINES).map((r) => r.nearX);

/**
 * Canvas2D POV road. A single <canvas> draws the wireframe grid (rails + metre
 * trusses) each frame through a dynamic camera; the SAME camera positions a DOM
 * overlay of rider avatars, so they sit on the road. One rAF loop owns both. The
 * camera leans toward the leader and pulses FOV on sprints — but rigidly (the
 * grid never deforms; "not jello"). See README.
 */
export default function PovGrid({ riderIds, riders, riderLive = {}, lapLengthM = 0, finishM = null }) {
  const distOf = (id) => Math.max(0, riders[id]?.cumulativeDistanceM || 0);
  // DNF riders are off the course entirely — excluded from BOTH the leader-anchored
  // zoom (so a stalled rider can't crush the scale) and the avatar overlay.
  const movedIds = riderIds.filter((id) => distOf(id) > 0 && !riderLive[id]?.dnf);
  const colorOf = (id) => LINE_COLORS[riderIds.indexOf(id) % LINE_COLORS.length];
  const zoom = useLeaderAnchoredZoom(movedIds.map(distOf), ZOOM_CFG);
  const laneX = (idx) => (movedIds.length <= 1 ? 50 : 12 + idx * (76 / (movedIds.length - 1)));

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const dimsRef = useRef({ w: 0, h: 0, dpr: 1 });
  const tickRef = useRef({ leaderPrev: 0, leaderCur: 0, kTarget: 0, riders: [], tickAt: 0, leaderVel: 0, accel: 0, leaderLaneX: 50 });
  const kRef = useRef(null);
  const camDynRef = useRef(NEUTRAL_DYNAMICS);
  const markerEls = useRef({});
  const prevDistRef = useRef({});
  // Live lap-gate config for the rAF loop (refreshed each render; the loop reads the ref).
  const gateCfgRef = useRef({ lapLengthM, finishM });
  gateCfgRef.current = { lapLengthM, finishM };
  // Component-scoped logger (the rAF loop reads it via this ref).
  const logRef = useRef(null);
  if (!logRef.current) logRef.current = getLogger().child({ component: 'pov-grid' });

  // Capture each new tick's targets (only on real data change), and derive the
  // camera signals (leader lane + acceleration) for the dynamics.
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
    const leaderCur = zoom.leaderDist;
    const leaderPrev = Number.isFinite(t.leaderCur) && t.leaderCur > 0 ? t.leaderCur : leaderCur;
    const leaderVel = Math.max(0, leaderCur - leaderPrev);
    const accel = leaderVel - (t.leaderVel || 0);
    const leaderId = movedIds.reduce((best, id) => (best && distOf(best) >= distOf(id) ? best : id), null);
    const leaderLaneX = leaderId ? laneX(movedIds.indexOf(leaderId)) : 50;
    // Camera audit: a rezoom (dolly/zoom change) is when the held zoom k jumps between ticks.
    const prevK = t.kTarget;
    if (prevK > 0 && Math.abs(zoom.kFrac - prevK) / prevK > 0.02) {
      const lastDist = movedIds.length ? Math.min(...movedIds.map(distOf)) : leaderCur;
      logRef.current.debug('cycle_game.pov.rezoom', { fromK: prevK, toK: zoom.kFrac, gapM: Math.round(leaderCur - lastDist) });
    }
    tickRef.current = {
      leaderPrev, leaderCur, kTarget: zoom.kFrac, riders: ridersFrame, tickAt: now,
      leaderVel, accel, leaderLaneX
    };
    const next = {}; movedIds.forEach((id) => { next[id] = distOf(id); });
    prevDistRef.current = next;
  });

  // Size the canvas backing store to devicePixelRatio for crisp lines; re-measure
  // on resize. jsdom returns null for getContext('2d') and 0-size rects — guarded.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    ctxRef.current = (canvas.getContext && canvas.getContext('2d')) || null;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const w = Math.max(0, Math.round(rect.width));
      const h = Math.max(0, Math.round(rect.height));
      dimsRef.current = { w, h, dpr };
      if (w > 0 && h > 0) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        if (ctxRef.current) ctxRef.current.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(canvas);
    }
    return () => { if (ro) ro.disconnect(); };
  }, []);

  // The 60fps loop — mounts once, draws the grid to canvas, positions avatars.
  useEffect(() => {
    let raf;
    let lastT = performance.now();
    const draw = () => {
      const nowT = performance.now();
      const dt = Math.min(64, nowT - lastT); lastT = nowT;
      const t = tickRef.current;

      const target = t.kTarget;
      if (!(kRef.current > 0)) kRef.current = target;
      else if (target > 0) kRef.current += (target - kRef.current) * (1 - Math.exp(-dt / K_TAU_MS));
      const kFrame = kRef.current;

      camDynRef.current = stepCameraDynamics(camDynRef.current, { leaderLaneX: t.leaderLaneX, accel: t.accel }, dt);
      const camera = cameraFrom(camDynRef.current);

      // Camera audit: periodic snapshot of all camera motion — zoom (k / fovMul /
      // depthRatio), pan (vanishX lateral lead), dolly (leaderDist). Rate-limited.
      logRef.current.sampled('cycle_game.pov.camera', {
        k: kFrame, vanishX: camera.vanishX, fovMul: camDynRef.current.fovMul,
        depthRatio: camera.depthRatio, leaderDistM: Math.round(t.leaderCur), leaderLaneX: t.leaderLaneX
      }, { maxPerMinute: 60, aggregate: false });

      const frac = tickFraction(nowT, t.tickAt, TICK_MS);
      const { lineSlots, markers } = computePovFrame({
        riders: t.riders, leaderPrev: t.leaderPrev, leaderCur: t.leaderCur,
        k: kFrame, frac, cam: camera, count: GRID_SLOTS, minorM: MINOR_M, majorM: MAJOR_M
      });

      // Lap gates at each lap multiple behind the interpolated leader (+ the finish).
      const leaderNow = t.leaderPrev + (t.leaderCur - t.leaderPrev) * frac;
      const gates = computeGates(leaderNow, kFrame, camera, gateCfgRef.current);

      drawScene(ctxRef.current, { camera, lineSlots, railsX: RAILS_X, gates, dims: dimsRef.current });

      markers.forEach((m) => {
        const el = markerEls.current[m.id];
        if (!el) return;
        const x = camera.vanishX + (m.laneX - camera.vanishX) * m.scale;
        el.style.transform =
          `translate3d(${x.toFixed(2)}cqw, ${(m.y * 100).toFixed(3)}cqh, 0) translate(-50%, -50%) scale(${(0.55 + 0.45 * m.scale).toFixed(3)})`;
        el.style.zIndex = String(100 + Math.round((1 - m.t) * 100)); // nearer (t→0) on top
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cg-pov" data-testid="race-pov">
      <canvas className="cg-pov__canvas" ref={canvasRef} aria-hidden="true" />
      <div className="cg-pov__avatars" aria-hidden="true">
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
    </div>
  );
}

PovGrid.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object,
  lapLengthM: PropTypes.number,
  finishM: PropTypes.number
};
