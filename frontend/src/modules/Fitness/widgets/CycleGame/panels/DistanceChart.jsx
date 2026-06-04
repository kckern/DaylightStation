import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { plotStartIndex } from '@/modules/Fitness/lib/cycleGame/chartTrim.js';
import getLogger from '@/lib/logging/Logger.js';
import { useFitGuard } from './useFitGuard.js';
import { nextZoomLevel, gridValues } from '@/modules/Fitness/lib/cycleGame/chartZoom.js';

const X_BASE_S = 30;        // level-0 time window (seconds; 1 sample = 1s at the 1Hz tick)
const Y_BASE_M = 250;       // level-0 distance window (metres)
const ZOOM_THRESHOLD = 0.9; // grow the window when data hits 90% of it
const GRID_MIN_PX = 32;    // never draw gridlines closer than this (bottom cap)

const EVENT_GLYPH = { dnf: '🛑', penalty: '⏱️' };

/**
 * Gradient-filled distance chart — one climbing lane per rider toward the goal,
 * with goal line, area fills, lane lines, and de-overlapped terminus tags.
 * Auto-scales linear→log when riders crowd together near the finish. Officiating
 * events (DNF / penalty) are re-projected onto the lane where they fired.
 */
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, events = [], zoneBox, elapsedS = 0 }) {
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

  // chart scaling — stepped zoom-out camera. The window doubles in 2x steps as
  // the leader's distance or the elapsed time nears the edge (monotonic level in
  // a sticky ref, like logRef). X maps over a time window T, Y over a distance
  // window D; the lin↔log crowding transform (below) is orthogonal and kept.
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));
  const leaderDistanceM = Math.max(0, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const zoomRef = useRef(0);
  zoomRef.current = nextZoomLevel(zoomRef.current, {
    leaderDistanceM, elapsedS, xBaseS: X_BASE_S, yBaseM: Y_BASE_M, threshold: ZOOM_THRESHOLD
  });
  const L = zoomRef.current;
  // Zoom-out animation: when the level jumps, start the content scaled up by the
  // jump ratio (so it looks like the pre-zoom scale) then ease to 1x — the world
  // shrinks into the new, wider frame about the bottom-left origin.
  const prevLevelRef = useRef(L);
  const [animScale, setAnimScale] = useState(1);
  useEffect(() => {
    if (L > prevLevelRef.current) {
      setAnimScale(2 ** (L - prevLevelRef.current));
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnimScale(1)));
      prevLevelRef.current = L;
      return () => cancelAnimationFrame(id);
    }
    prevLevelRef.current = L;
    return undefined;
  }, [L]);
  const W = 600, H = 200;
  const T = X_BASE_S * 2 ** L;   // seconds visible
  const D = Y_BASE_M * 2 ** L;   // metres visible
  const stepS = maxSeriesLen > 1 ? elapsedS / (maxSeriesLen - 1) : 1;
  const xForTime = (t) => Math.min(W, ((t || 0) / T) * W);
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
    if (useLog) {
      const Dd = Math.max(1, D);
      return H - (Math.log1p(Math.max(0, d || 0)) / Math.log1p(Dd)) * H;
    }
    return H - Math.min(1, (d || 0) / D) * H;
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
    const maxTop = 96;
    if (raw.length && raw[raw.length - 1].topPct > maxTop) {
      let next = Infinity;
      for (let i = raw.length - 1; i >= 0; i--) {
        const t = raw[i];
        t.topPct = Math.min(t.topPct, i === raw.length - 1 ? maxTop : next - minSepPct);
        next = t.topPct;
      }
    }
    raw.forEach((t) => { if (t.topPct < 3) t.topPct = 3; });
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
    <div className="cycle-race-screen__chart-wrap" ref={chartRef}>
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
          style={{ transform: `scale(${animScale})`, transformOrigin: `0px ${H}px`, transformBox: 'view-box' }}
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

        {winCondition === 'distance' && (
          <line className="cycle-race-screen__goal" x1="0" y1="0" x2={W} y2="0" vectorEffect="non-scaling-stroke" />
        )}

        {/* area fills (under each lane) */}
        {riderIds.map((id, idx) => {
          const series = riders[id].distanceSeries || [];
          // Skip the leading flat-zero run (e.g. a penalty-boxed late start): the
          // fill begins where the rider first moves. No movement at all → no fill.
          const start = plotStartIndex(series);
          if (start < 0) return null;
          const linePts = series.slice(start).map((d, i) => `${xFor(start + i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
          const startX = xFor(start).toFixed(1);
          const lastX = xFor(series.length - 1).toFixed(1);
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
          const series = riders[id].distanceSeries || [];
          // Line begins at first movement — a rider boxed at the start emerges
          // from the axis to the right of the origin, never a flat zero line.
          const start = plotStartIndex(series);
          if (start < 0) return null;
          const pts = series.slice(start).map((d, i) => `${xFor(start + i).toFixed(1)},${yFor(d).toFixed(1)}`).join(' ');
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
};
