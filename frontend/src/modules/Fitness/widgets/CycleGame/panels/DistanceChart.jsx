import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { plotStartIndex } from '@/modules/Fitness/lib/cycleGame/chartTrim.js';
import getLogger from '@/lib/logging/Logger.js';
import { useFitGuard } from './useFitGuard.js';
import { nextZoomLevel, gridValues } from '@/modules/Fitness/lib/cycleGame/chartZoom.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import './DistanceChart.scss';

const X_BASE_S = 20;        // level-0 time window (seconds; 1 sample = 1s at the 1Hz tick)
const Y_BASE_M = 150;       // level-0 distance window (metres) — tight so the lanes fill
                            // the chart instead of sitting half-empty (window grows in 2x steps)
const ZOOM_THRESHOLD = 0.9; // grow the window when data hits 90% of it
const GRID_MIN_PX = 32;    // never draw gridlines closer than this (bottom cap)
const ZOOM_ANIM_MS = 300;  // zoom-out camera ease duration
const TICK_INTERP_MS = 1000; // glide the leading edge over one 1Hz tick interval

const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);

const EVENT_GLYPH = { dnf: '🛑', penalty: '⏱️' };

/**
 * Gradient-filled distance chart — one climbing lane per rider toward the goal,
 * with goal line, area fills, lane lines, and de-overlapped terminus tags.
 * Auto-scales linear→log when riders crowd together near the finish. Officiating
 * events (DNF / penalty) are re-projected onto the lane where they fired.
 */
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, events = [], zoneBox, elapsedS = 0, clockSeconds = 0, maxDistanceM = 0 }) {
  const chartRef = useRef(null);
  const fitRef = useRef(null);
  const fitScaleVal = useFitGuard(fitRef, zoneBox, 'distanceChart');
  const [chartH, setChartH] = useState(220); // chart px height (for collision spacing)
  const lastHRef = useRef(220);
  const log = useMemo(() => getLogger().child({ component: 'cycle-distance-chart' }), []);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return undefined;
    // Only react to a real height change — logs the new dimension (so layout
    // thrashing is visible in telemetry) and avoids redundant re-renders.
    const compute = () => {
      const next = el.clientHeight || 220;
      if (next === lastHRef.current) return;
      lastHRef.current = next;
      log.debug('cycle_game.chart_resize', { h: next });
      setChartH(next);
    };
    compute();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(compute); ro.observe(el); }
    return () => { if (ro) ro.disconnect(); };
  }, [log]);

  // chart scaling — stepped zoom-out camera, DECOUPLED per axis. The TIME axis (T)
  // grows to fit elapsed; the DISTANCE axis (D) grows to fit the leader —
  // independently and monotonically. (A single shared level let a long time race's
  // time-zoom blow up the distance window too, squashing the lanes into the bottom
  // corner.) The lin↔log crowding transform (below) is orthogonal and kept.
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const leaderDistanceM = Math.max(0, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  // Distance races have a fixed finish: pin the Y window to the goal so the goal line
  // sits at the TOP and riders climb toward it (vs. the time-race auto-zoom that grows
  // the window to fit the leader and parks the goal mid-chart).
  const distanceGoal = winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0;
  // nextZoomLevel keeps BOTH inputs under threshold; feed each axis only its own
  // driver (0 for the other, which always fits) to get an independent level.
  const lxRef = useRef(0);
  const lyRef = useRef(0);
  lxRef.current = nextZoomLevel(lxRef.current, { elapsedS, leaderDistanceM: 0, xBaseS: X_BASE_S, yBaseM: Y_BASE_M, threshold: ZOOM_THRESHOLD });
  lyRef.current = distanceGoal ? 0 : nextZoomLevel(lyRef.current, { elapsedS: 0, leaderDistanceM, xBaseS: X_BASE_S, yBaseM: Y_BASE_M, threshold: ZOOM_THRESHOLD });
  const Lx = lxRef.current;
  const Ly = lyRef.current;
  // Zoom-out animation: when either axis level jumps, SNAP that axis by the jump
  // ratio with NO transition (so it reads as the pre-zoom scale), then on the next
  // frame ease back to 1x over ZOOM_ANIM_MS — the world shrinks into the new, wider
  // frame about the bottom-left origin. Toggling the transition off for the snap is
  // the trick: leaving it on animates 1→ratio and gets interrupted (reads abrupt).
  const prevLxRef = useRef(Lx);
  const prevLyRef = useRef(Ly);
  const [zoom, setZoom] = useState({ sx: 1, sy: 1, animate: false });
  useEffect(() => {
    const bumpX = Lx > prevLxRef.current;
    const bumpY = Ly > prevLyRef.current;
    if (bumpX || bumpY) {
      const sx = bumpX ? 2 ** (Lx - prevLxRef.current) : 1;
      const sy = bumpY ? 2 ** (Ly - prevLyRef.current) : 1;
      prevLxRef.current = Lx;
      prevLyRef.current = Ly;
      setZoom({ sx, sy, animate: false });
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setZoom({ sx: 1, sy: 1, animate: true })));
      return () => cancelAnimationFrame(id);
    }
    prevLxRef.current = Lx;
    prevLyRef.current = Ly;
    return undefined;
  }, [Lx, Ly]);
  const W = 600, H = 200;
  // Internal plot padding (viewBox units) so line tips, terminus nodes, and the
  // goal line never clip against the panel edges — all content maps into the inset
  // rect, never to 0/W/H. (The panel zone is overflow:hidden.)
  const PAD_T = 22, PAD_B = 22, PAD_L = 16, PAD_R = 36;
  const PLOT_W = W - PAD_L - PAD_R;
  const PLOT_H = H - PAD_T - PAD_B;
  const T = X_BASE_S * 2 ** Lx;   // seconds visible
  // Distance race: window = goal (goal line pinned to the top). Time race: auto-zoom window.
  const D = distanceGoal ? goalM : Y_BASE_M * 2 ** Ly;   // metres visible
  const stepS = maxSeriesLen > 1 ? elapsedS / (maxSeriesLen - 1) : 1;
  const xForTime = (t) => PAD_L + Math.max(0, Math.min(1, (t || 0) / T)) * PLOT_W;
  const xFor = (i) => xForTime(i * stepS);

  // Lin↔log crowding transform (kept): switch to log when adjacent leaders bunch
  // within the window, with hysteresis so it doesn't flap.
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const logRef = useRef(false);
  if (riderIds.length >= 2) {
    const sorted = [...lastDists].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
    if (!logRef.current && minGap < D * 0.05) logRef.current = true;
    else if (logRef.current && minGap > D * 0.14) logRef.current = false;
  } else {
    logRef.current = false;
  }
  const useLog = logRef.current;
  const yFor = (d) => {
    const frac = useLog
      ? 1 - (Math.log1p(Math.max(0, D - (d || 0))) / Math.log1p(Math.max(1, D)))
      : Math.min(1, (d || 0) / D);
    return (H - PAD_B) - Math.max(0, Math.min(1, frac)) * PLOT_H;
  };

  // ── Smooth leading edge ────────────────────────────────────────────────────
  // The engine ticks at 1 Hz, so each line's newest point jumps once per second
  // while its terminus node glides (CSS transition). Glide the line tip too: lerp
  // it from its previous-tick position to the current one across the tick interval
  // via a rAF clock, so the line grows continuously instead of snapping.
  const tickKey = `${maxSeriesLen}`;
  const prevTipsRef = useRef({});
  const lastTipsRef = useRef({});
  const tickKeyRef = useRef(tickKey);
  const tickAtRef = useRef(0);
  const [tickFrac, setTickFrac] = useState(1);
  const curTips = {};
  riderIds.forEach((id) => {
    const series = riders[id].distanceSeries || [];
    const last = series.length - 1;
    if (last < 0) return;
    curTips[id] = { x: xFor(last), y: yFor(series[last]) };
  });
  if (tickKeyRef.current !== tickKey) {
    prevTipsRef.current = lastTipsRef.current;   // tip positions as of the prior tick
    tickKeyRef.current = tickKey;
    tickAtRef.current = (typeof performance !== 'undefined' ? performance.now() : 0);
  }
  lastTipsRef.current = curTips;                  // remember for next tick's prev
  useEffect(() => {
    setTickFrac(0);
    if (typeof requestAnimationFrame === 'undefined') { setTickFrac(1); return undefined; }
    let raf;
    const step = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : 0);
      const f = TICK_INTERP_MS > 0 ? Math.min(1, (now - tickAtRef.current) / TICK_INTERP_MS) : 1;
      setTickFrac(f);
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [tickKey]);
  const tipFrac = easeOutQuad(Math.min(1, Math.max(0, tickFrac)));
  const tipFor = (id) => {
    const cur = curTips[id];
    if (!cur) return null;
    const prev = prevTipsRef.current[id];
    if (!prev) return cur;
    return { x: prev.x + (cur.x - prev.x) * tipFrac, y: prev.y + (cur.y - prev.y) * tipFrac };
  };
  // Shared mapped coordinates for a rider's lane (area + line), tip interpolated.
  const lineCoordsFor = (id) => {
    const series = riders[id].distanceSeries || [];
    const start = plotStartIndex(series);
    if (start < 0) return null;
    const coords = series.slice(start).map((d, i) => ({ x: xFor(start + i), y: yFor(d) }));
    const tip = tipFor(id);
    if (tip && coords.length) coords[coords.length - 1] = tip;
    return { coords, start };
  };

  // leader (for emphasis) — furthest along
  const leaderId = riderIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );

  // Tag positions with 1D vertical de-overlap (collision avoidance, mirroring
  // the fitness chart's displace-and-connect): tips that crowd are pushed apart
  // and a connector links the displaced tag back to its true line endpoint.
  const minSepPct = Math.min(38, (46 / Math.max(80, chartH)) * 100);
  const tagLayout = (() => {
    const raw = riderIds.map((id, idx) => {
      const series = riders[id].distanceSeries || [];
      if (!series.length) return null;
      return {
        id,
        idx,
        leftPct: (xFor(series.length - 1) / W) * 100,
        rawTopPct: (yFor(series[series.length - 1]) / H) * 100,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        isGhost: !!riders[id].isGhost,
        live: riderLive[id] || {},
        distanceM: riders[id].cumulativeDistanceM || 0,
        displayName: riders[id].displayName,
        isLeader: id === leaderId
      };
    }).filter(Boolean).sort((a, b) => a.rawTopPct - b.rawTopPct);

    // forward pass — push down to keep min separation
    let prev = -Infinity;
    raw.forEach((t) => { t.topPct = Math.max(t.rawTopPct, prev + minSepPct); prev = t.topPct; });
    // backward pass — if the stack overflowed the bottom, pull it up
    const maxTop = 88;
    if (raw.length && raw[raw.length - 1].topPct > maxTop) {
      let next = Infinity;
      for (let i = raw.length - 1; i >= 0; i--) {
        const t = raw[i];
        t.topPct = Math.min(t.topPct, i === raw.length - 1 ? maxTop : next - minSepPct);
        next = t.topPct;
      }
    }
    raw.forEach((t) => { if (t.topPct < 11) t.topPct = 11; });
    return raw;
  })();

  // Officiating-event markers (DNF / penalty), anchored to where they fired on
  // the rider's lane. seriesIndex + distanceM were captured at event time; we
  // re-project them with the current scale so each marker tracks its line point.
  const eventMarkers = events.map((e) => {
    const idx = riderIds.indexOf(e.riderId);
    if (idx < 0) return null;
    return {
      id: e.id,
      type: e.type,
      glyph: EVENT_GLYPH[e.type] || '•',
      leftPct: (xFor(e.seriesIndex) / W) * 100,
      topPct: (yFor(e.distanceM) / H) * 100,
      color: LINE_COLORS[idx % LINE_COLORS.length]
    };
  }).filter(Boolean);

  // Gridlines at decimated fixed units, positioned through the active transforms
  // (Y via yFor, so log mode compresses them toward the top — the grid morph
  // signals the scale change alongside the line shapes).
  const xGrid = gridValues(T, X_BASE_S, W, GRID_MIN_PX).map((t) => ({ t, x: xForTime(t) }));
  const yGrid = gridValues(D, Y_BASE_M, H, GRID_MIN_PX).map((d) => ({ d, y: yFor(d) }));

  return (
    <div className="cg-chart" data-testid="distance-chart">
      <div className="cg-chart__header" data-testid="chart-header">
        <span className="cg-chart__clock-label">{winCondition === 'time' ? 'Time left' : 'Elapsed'}</span>
        <span className="cg-chart__clock">{formatClock(clockSeconds)}</span>
        <span className="cg-chart__goal">
          {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : `${formatDistance(maxDistanceM)} led`}
        </span>
      </div>
      <div className="cg-chart__plot" ref={chartRef}>
      <div ref={fitRef} style={fitScaleVal < 1 ? { transform: `scale(${fitScaleVal})`, transformOrigin: 'top left' } : undefined}>
      <svg className="cycle-race-screen__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          {riderIds.map((id, idx) => {
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            return (
              <linearGradient key={`g-${id}`} id={`cg-fill-${idx}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.34" />
                <stop offset="100%" stopColor={color} stopOpacity="0.02" />
              </linearGradient>
            );
          })}
        </defs>

        <g
          data-testid="chart-zoomable"
          className="cycle-race-screen__zoomable"
          style={{
            transform: `scale(${zoom.sx}, ${zoom.sy})`,
            transformOrigin: `0px ${H}px`,
            transformBox: 'view-box',
            transition: zoom.animate ? `transform ${ZOOM_ANIM_MS}ms ease-out` : 'none'
          }}
        >

        <g className="cycle-race-screen__grid" data-testid="chart-grid">
          {xGrid.map(({ t, x }) => (
            <line key={`gx-${t}`} className="cycle-race-screen__gridline cycle-race-screen__gridline--x"
              x1={x.toFixed(1)} y1="0" x2={x.toFixed(1)} y2={H} vectorEffect="non-scaling-stroke" />
          ))}
          {yGrid.map(({ d, y }) => (
            <line key={`gy-${d}`} className="cycle-race-screen__gridline cycle-race-screen__gridline--y"
              x1="0" y1={y.toFixed(1)} x2={W} y2={y.toFixed(1)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* area fills (under each lane) */}
        {riderIds.map((id, idx) => {
          // Skip the leading flat-zero run (e.g. a penalty-boxed late start): the
          // fill begins where the rider first moves. No movement at all → no fill.
          const lc = lineCoordsFor(id);
          if (!lc) return null;
          const linePts = lc.coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          const startX = lc.coords[0].x.toFixed(1);
          const lastX = lc.coords[lc.coords.length - 1].x.toFixed(1);
          const area = `${startX},${H} ${linePts} ${lastX},${H}`;
          return (
            <polygon
              key={`area-${id}`}
              points={area}
              fill={`url(#cg-fill-${idx})`}
              opacity={riders[id].isGhost ? 0.4 : 1}
            />
          );
        })}

        {/* lane lines */}
        {riderIds.map((id, idx) => {
          // Line begins at first movement — a rider boxed at the start emerges
          // from the axis to the right of the origin, never a flat zero line.
          const lc = lineCoordsFor(id);
          if (!lc) return null;
          const pts = lc.coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          const color = LINE_COLORS[idx % LINE_COLORS.length];
          const isGhost = !!riders[id].isGhost;
          return (
            <polyline
              key={id}
              data-testid="race-line"
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={isGhost ? 2 : 3}
              strokeDasharray={isGhost ? '5 6' : undefined}
              opacity={isGhost ? 0.8 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0 && (
          <line className="cycle-race-screen__goal"
            x1={PAD_L} y1={yFor(goalM).toFixed(1)} x2={W - PAD_R} y2={yFor(goalM).toFixed(1)}
            vectorEffect="non-scaling-stroke" />
        )}

        </g>
      </svg>

      {/* Terminus markers: each line's tip carries the rider's avatar + running
          score (distance) + live HR. Distance is read here, not off a y-axis.
          Tags are de-overlapped vertically; a connector links a displaced tag
          back to its true line endpoint. */}
      <div className="cycle-race-screen__tags">
        {tagLayout.map((t) => {
          const displaced = Math.abs(t.topPct - t.rawTopPct) > 1.5;
          return displaced ? (
            <div
              key={`conn-${t.id}`}
              className="cycle-race-screen__tag-connector"
              style={{
                left: `${t.leftPct}%`,
                top: `${Math.min(t.topPct, t.rawTopPct)}%`,
                height: `${Math.abs(t.topPct - t.rawTopPct)}%`,
                background: t.color
              }}
            />
          ) : null;
        })}
        {tagLayout.map((t) => (
          <div
            key={`tag-${t.id}`}
            className={`cycle-race-screen__tag${t.isGhost ? ' is-ghost' : ''}${t.isLeader ? ' is-leader' : ''}`}
            style={{ left: `${t.leftPct}%`, top: `${t.topPct}%` }}
          >
            <span className="cycle-race-screen__node" style={{ background: t.color }}>
              {String(t.displayName || t.id).trim().charAt(0).toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      {/* Officiating-event markers pinned to the lane where each fired. */}
      {eventMarkers.length > 0 && (
        <div className="cycle-race-screen__markers" data-testid="race-event-markers">
          {eventMarkers.map((m) => (
            <div
              key={`evt-${m.id}`}
              className={`cycle-race-screen__marker cycle-race-screen__marker--${m.type}`}
              data-testid={`race-event-marker-${m.type}`}
              style={{ left: `${m.leftPct}%`, top: `${m.topPct}%`, '--marker-color': m.color }}
            >
              <span className="cycle-race-screen__marker-glyph" aria-hidden="true">{m.glyph}</span>
            </div>
          ))}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}

DistanceChart.propTypes = {
  riderIds: PropTypes.array.isRequired,
  riders: PropTypes.object.isRequired,
  riderLive: PropTypes.object.isRequired,
  winCondition: PropTypes.string,
  goalM: PropTypes.number,
  events: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.number,
    type: PropTypes.oneOf(['dnf', 'penalty']),
    riderId: PropTypes.string,
    seriesIndex: PropTypes.number,
    distanceM: PropTypes.number
  })),
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }),
  elapsedS: PropTypes.number,
  clockSeconds: PropTypes.number,
  maxDistanceM: PropTypes.number,
};
