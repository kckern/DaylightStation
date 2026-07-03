import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import { StopSignIcon, TimeIcon, RaceFlagIcon } from '../home/icons.jsx';
import { plotStartIndex } from '@/modules/Fitness/lib/cycleGame/chartTrim.js';
import getLogger from '@/lib/logging/Logger.js';
import { useFitGuard } from './useFitGuard.js';
import { continuousWindow, gridValues, pickAxisTicks } from '@/modules/Fitness/lib/cycleGame/chartZoom.js';
import { formatClock } from '@/modules/Fitness/lib/cycleGame/cycleGameLobby.js';
import { formatDistance } from '@/modules/Fitness/lib/cycleGame/formatDistance.js';
import { gapFrac } from '@/modules/Fitness/lib/cycleGame/chartScale.js';
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { createTickLerp } from '@/modules/Fitness/lib/cycleGame/motionClock.js';
import './DistanceChart.scss';

const X_BASE_S = 20;        // smallest time window (seconds; 1 sample = 1s at the 1Hz tick)
const Y_BASE_M = 150;       // smallest distance window (metres) for a TIME race's auto-zoom
const FILL_FRAC = 0.85;     // keep the leading data at ~85% of the window (the rest is headroom)
const GRID_MIN_PX = 32;     // never draw gridlines closer than this (bottom cap)
const TICK_INTERP_MS = 1000; // glide the leading edge over one 1Hz tick interval
const LOG_TWEEN_MS = 400;   // lin↔log flip crossfade duration (audit UX 2.7)
const MAX_PLOT_POINTS = 600; // decimate longer series to bound per-tick geometry cost
const FALLBACK_AVATAR = '/api/v1/static/img/users/user';

// Officiating-event marker icons (audit UX §6.3 — 🛑/⏱️ emoji → icon set).
const EVENT_GLYPH = { dnf: StopSignIcon, penalty: TimeIcon };

// ── SVG plot geometry (fixed viewBox) ──────────────────────────────────────
const W = 600, H = 200;
// Internal plot padding (viewBox units) so line tips, terminus nodes, and the
// goal line never clip against the panel edges — all content maps into the inset
// rect, never to 0/W/H. (The panel zone is overflow:hidden.)
const PAD_T = 22, PAD_B = 22, PAD_L = 16, PAD_R = 36;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, f) => a + (b - a) * f;
const perfNow = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());

// Map a (time, distance) datum into viewBox coords under a window descriptor.
// `win = { T, D, leaderM, kGap, mix }` — mix in [0,1] blends the linear
// absolute-distance mapping (0) with the leader-anchored gap-log mapping (1).
// Pure: used for the static per-tick render AND the per-frame eased remap, so
// the two can't disagree at the tick boundary (fraction 0/1).
function mapPoint(t, d, win) {
  const x = PAD_L + clamp01((t || 0) / win.T) * PLOT_W;
  const lin = clamp01((d || 0) / win.D);
  const lg = win.mix > 0 ? gapFrac(d, win.leaderM, 0, win.kGap) : 0;
  const frac = clamp01((1 - win.mix) * lin + win.mix * lg);
  const y = (H - PAD_B) - frac * PLOT_H;
  return { x, y };
}

const ptsStr = (coords) => coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

// De-overlap a set of {id, rawTopPct} tags vertically (push-down pass, then a
// pull-up pass if the stack overflows the bottom) — pure, no rider/window
// knowledge. Shared by the tick-boundary layout AND the per-frame remap so
// both use the IDENTICAL stacking rule.
function deoverlapTops(items, minSepPct) {
  const sorted = [...items].sort((a, b) => a.rawTopPct - b.rawTopPct);
  let prev = -Infinity;
  sorted.forEach((t) => { t.topPct = Math.max(t.rawTopPct, prev + minSepPct); prev = t.topPct; });
  const maxTop = 88;
  if (sorted.length && sorted[sorted.length - 1].topPct > maxTop) {
    let next = Infinity;
    for (let i = sorted.length - 1; i >= 0; i--) {
      const t = sorted[i];
      t.topPct = Math.min(t.topPct, i === sorted.length - 1 ? maxTop : next - minSepPct);
      next = t.topPct;
    }
  }
  sorted.forEach((t) => { if (t.topPct < 11) t.topPct = 11; });
  return sorted;
}

// Terminus tag layout under a given (t,d)-per-rider + window — pure. Called
// BOTH for the tick-boundary render (tip = the rider's last plotted sample,
// win = curWin) AND every animation frame (tip = the lerped prev→cur tip,
// win = the eased winF) — the SAME formula, so a tag can never trace a
// different path than the line tip sitting beneath it during an active zoom
// (the bug this fixes: tags used to lerp between two STATIC percentages each
// computed under a DIFFERENT tick's window, instead of re-deriving position
// from the window that's actually active on screen right now).
function layoutTags(tips, win, minSepPct) {
  const raw = tips.map((r) => {
    const { x, y } = mapPoint(r.t, r.d, win);
    return { ...r, leftPct: (x / W) * 100, rawTopPct: (y / H) * 100 };
  });
  return deoverlapTops(raw, minSepPct);
}

/**
 * Finish-line distance chart — one climbing lane per rider toward the goal, built
 * to answer "how much is left" at a glance.
 *
 * DISTANCE races: the Y domain is FIXED at [0..goalM] from the very first tick, so
 * the goal line sits at the top and every lane visibly climbs toward the finish
 * the whole race (no Y zoom, ever). TIME races keep an auto-zoom, but CONTINUOUS —
 * the window grows smoothly with the data (no 2× rug-pulls) and the lin↔log
 * crowding flip crossfades over ~400 ms with a "zoomed on leaders" chip.
 *
 * Motion (T6 architecture): the engine ticks at 1 Hz. Geometry is computed ONCE
 * per tick during render; the lane lines/areas, terminus tags, connectors and
 * event markers then GLIDE on a single shared linear rAF clock (motionClock),
 * written imperatively. React never re-renders per animation frame. The line
 * remap eases the WINDOW bounds prev→cur across the tick, so a continuous zoom
 * reads as a smooth drift rather than a per-tick snap.
 *
 * Terminus tags carry a 28px rider avatar (ghost-treated) + gap-behind-leader
 * text; the leader's tag shows total distance. Axis labels are an HTML overlay
 * (≥1.1rem): distance up the Y axis (gap-behind-leader in log mode), m:ss across X.
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

  const leaderDistanceM = Math.max(0, ...riderIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));

  // Distance races have a fixed finish: pin the Y window to the goal so the goal
  // line sits at the TOP and lanes climb toward it the whole race.
  const distanceGoal = winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0;

  // ── Continuous windows (no stepped 2× zoom) ────────────────────────────────
  // Time axis grows continuously to hold elapsed at ~85% of the window (both race
  // types). Distance axis: FIXED to the goal for a distance race; continuous
  // auto-zoom to fit the leader for a time race. Enforce monotonic (only zoom out)
  // against sensor jitter via refs.
  const timeWinRef = useRef(X_BASE_S);
  const distWinRef = useRef(Y_BASE_M);
  const winT = Math.max(timeWinRef.current, continuousWindow(elapsedS, { base: X_BASE_S, fillFrac: FILL_FRAC }));
  timeWinRef.current = winT;
  let winD;
  if (distanceGoal) {
    winD = goalM;
  } else {
    winD = Math.max(distWinRef.current, continuousWindow(leaderDistanceM, { base: Y_BASE_M, fillFrac: FILL_FRAC }));
    distWinRef.current = winD;
  }

  // ── Lin↔log crowding transform (TIME races only) ───────────────────────────
  // A distance race keeps its truthful fixed-linear scale (goal at top). A time
  // race switches to a leader-anchored gap-log when adjacent leaders bunch, with
  // hysteresis so it doesn't flap; the flip crossfades (logMix) over LOG_TWEEN_MS.
  const lastDists = riderIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const leaderM = lastDists.length ? Math.max(...lastDists) : 0;
  const K_GAP = 4;
  const K_GAP_FRAC = 0.5;
  const logRef = useRef(false);
  if (!distanceGoal && riderIds.length >= 2) {
    const sorted = [...lastDists].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) minGap = Math.min(minGap, sorted[i] - sorted[i - 1]);
    if (!logRef.current && minGap < winD * 0.05) logRef.current = true;
    else if (logRef.current && minGap > winD * 0.14) logRef.current = false;
  } else {
    logRef.current = false;
  }
  const useLog = logRef.current;
  const kGap = Math.max(K_GAP, leaderM * K_GAP_FRAC);

  // Current-tick window descriptor (mix = full log/lin for the static render).
  const curWin = { T: winT, D: winD, leaderM, kGap, mix: useLog ? 1 : 0 };
  const stepS = maxSeriesLen > 1 ? elapsedS / (maxSeriesLen - 1) : 1;
  const xForTime = (t) => mapPoint(t, 0, curWin).x;
  const xFor = (i) => xForTime(i * stepS);
  const yFor = (d) => mapPoint(0, d, curWin).y;

  // A finished rider's lane freezes at the sample where they crossed the goal.
  const plottedLen = (id) => {
    const series = riders[id].distanceSeries || [];
    if (riders[id].finishTimeS == null) return series.length;
    const fin = series.findIndex((d) => d >= Math.round(goalM));
    if (fin >= 0) return fin + 1;
    const idx = stepS > 0 ? Math.round(riders[id].finishTimeS / stepS) : series.length - 1;
    return Math.max(1, Math.min(series.length, idx + 1));
  };

  // ── Per-tick lane geometry (computed ONCE per rider per tick) ───────────────
  // Each lane's decimated {t,d} samples + their mapped coords under curWin. The
  // per-frame writer re-maps these samples under the eased window; storing the raw
  // data (not just pixels) is what lets the window bounds interpolate smoothly.
  const lanes = useMemo(() => riderIds.map((id, idx) => {
    const series = riders[id].distanceSeries || [];
    const start = plotStartIndex(series);
    const end = plottedLen(id);
    if (start < 0 || start >= end) return null;
    const n = end - start;
    const stride = n > MAX_PLOT_POINTS ? Math.ceil(n / MAX_PLOT_POINTS) : 1;
    const samples = [];
    for (let i = start; i < end; i += stride) samples.push({ t: i * stepS, d: series[i] });
    const lastIdx = end - 1;
    if ((lastIdx - start) % stride !== 0) samples.push({ t: lastIdx * stepS, d: series[lastIdx] });
    const coords = samples.map((s) => mapPoint(s.t, s.d, curWin));
    return {
      id, idx,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      isGhost: !!riders[id].isGhost,
      samples,
      coords,
      tip: coords[coords.length - 1],
      curTipData: samples[samples.length - 1],
      startX: coords[0].x,
      pointsStr: ptsStr(coords),
    };
    // Recompute whenever data advances or the scale/height changes — all per-tick
    // / per-resize events, never per animation frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [riderIds, riders, maxSeriesLen, elapsedS, winT, winD, useLog, goalM, winCondition, chartH]).filter(Boolean);

  // leader (for emphasis / gap) — furthest along
  const leaderId = riderIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );
  const leaderDistM = leaderId != null ? (riders[leaderId].cumulativeDistanceM || 0) : 0;

  // ── Terminus tags: avatar + gap-behind-leader (leader shows total) ──────────
  // Position comes from layoutTags (shared with the per-frame remap below);
  // display-only fields (avatar/name/color/gap text) are tick-scoped — they
  // don't need per-frame smoothing, only the position does. Reuses each
  // lane's tip datum directly (same rider, same "last plotted sample") so a
  // tag can never disagree with its own line about where that sample is.
  const minSepPct = Math.min(38, (46 / Math.max(80, chartH)) * 100);
  const laneById = {};
  lanes.forEach((l) => { laneById[l.id] = l; });
  const tagTips = riderIds.map((id) => {
    const l = laneById[id];
    return l ? { id, t: l.curTipData.t, d: l.curTipData.d } : null;
  }).filter(Boolean);
  const tagPositions = layoutTags(tagTips, curWin, minSepPct);
  const tagLayout = tagPositions.map((p) => {
    const id = p.id;
    const idx = riderIds.indexOf(id);
    const distanceM = riders[id].cumulativeDistanceM || 0;
    const isLeader = id === leaderId;
    const ident = resolveParticipantIdentity(riders[id].userId || id, riders[id].displayName);
    const avatarSrc = (riderLive[id] || {}).avatarSrc || riders[id].avatarSrc || ident.avatarSrc || FALLBACK_AVATAR;
    const gapText = isLeader
      ? formatDistance(distanceM)
      : `−${formatDistance(Math.max(0, leaderDistM - distanceM))}`;
    return {
      id, idx, leftPct: p.leftPct, rawTopPct: p.rawTopPct, topPct: p.topPct,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      isGhost: !!riders[id].isGhost,
      avatarSrc, distanceM, displayName: riders[id].displayName, gapText, isLeader
    };
  });

  // Officiating-event markers (DNF / penalty), re-projected onto their lane point.
  // t/d are the FIXED historical datum (a past event never moves); only the
  // window is eased, so the per-frame writer re-derives position from these
  // via mapPoint(t, d, winF) directly — no prev/cur lerp needed on the datum.
  const eventMarkers = events.map((e) => {
    const idx = riderIds.indexOf(e.riderId);
    if (idx < 0) return null;
    const t = e.seriesIndex * stepS;
    const d = e.distanceM;
    return {
      id: e.id,
      type: e.type,
      Glyph: EVENT_GLYPH[e.type] || null,
      t, d,
      leftPct: (xForTime(t) / W) * 100,
      topPct: (yFor(d) / H) * 100,
      color: LINE_COLORS[idx % LINE_COLORS.length]
    };
  }).filter(Boolean);

  // Gridlines + HTML axis labels (≥1.1rem). Y: distance values (gap-behind-leader
  // in log mode); X: m:ss. Both anchored to the gridlines, ≤3 labels per axis.
  const xGridVals = gridValues(winT, X_BASE_S, W, GRID_MIN_PX);
  const yGridVals = gridValues(winD, Y_BASE_M, H, GRID_MIN_PX);
  const xGrid = xGridVals.map((t) => ({ t, x: xForTime(t) }));
  const yGrid = yGridVals.map((d) => ({ d, y: yFor(d) }));
  const xLabels = pickAxisTicks(xGridVals, 3).map((t) => ({
    key: `xl-${t}`, leftPct: (xForTime(t) / W) * 100, text: formatClock(t)
  }));
  const yLabels = pickAxisTicks(yGridVals, 3).map((d) => ({
    key: `yl-${d}`,
    topPct: (yFor(d) / H) * 100,
    text: useLog ? (d >= leaderM ? '0' : `−${formatDistance(Math.max(0, leaderM - d))}`) : formatDistance(d)
  }));

  // ── One shared motion clock: eased window remap + tags / connectors / markers ─
  const lineEls = useRef({});
  const areaEls = useRef({});
  const tagEls = useRef({});
  const connEls = useRef({});
  const markerEls = useRef({});
  const motionRef = useRef({ lanes: [], tags: [], conns: [], markers: [], prevWin: curWin, curWin });
  const clockRef = useRef(null);
  if (!clockRef.current) clockRef.current = createTickLerp({ intervalMs: TICK_INTERP_MS });

  // logMix crossfade state (0=lin, 1=log), computed per-frame from an ABSOLUTE
  // flip timestamp (robust across the clock parking + re-arming between ticks).
  const logMixRef = useRef(useLog ? 1 : 0);
  const logTargetRef = useRef(useLog ? 1 : 0);
  const logFlipAtRef = useRef(0);
  const logMixAtFlipRef = useRef(useLog ? 1 : 0);
  const nextTarget = useLog ? 1 : 0;
  if (nextTarget !== logTargetRef.current) {
    logMixAtFlipRef.current = logMixRef.current; // start the tween from where we are
    logFlipAtRef.current = perfNow();
    logTargetRef.current = nextTarget;
  }

  // Prev/last per-tick tip snapshots for the interpolation start point (LINES
  // and TAGS share these — a tag's tip IS its lane's tip, see tagTips above).
  // Rotated when a new engine tick arrives (tickKey advances once per tick).
  const tickKey = maxSeriesLen;
  const tickKeyRef = useRef(tickKey);
  const prevTipData = useRef({});
  const lastTipData = useRef({});
  const prevWinRef = useRef(curWin);
  const lastWinRef = useRef(curWin);

  const curTipData = {};
  lanes.forEach((l) => { curTipData[l.id] = l.curTipData; });

  if (tickKeyRef.current !== tickKey) {
    prevTipData.current = lastTipData.current;
    prevWinRef.current = lastWinRef.current;
    tickKeyRef.current = tickKey;
  }
  lastTipData.current = curTipData;
  lastWinRef.current = curWin;

  // Imperative motion payload (read fresh each frame from the ref → a mid-tick
  // resize/rescale re-render is picked up without a stale closure). Tags and
  // markers carry only IDENTITY + raw tip data here — their SCREEN POSITION is
  // recomputed fresh every frame in the subscriber below (via layoutTags /
  // mapPoint under the live eased window), not lerped between two stale
  // per-tick percentages, so a tag/marker can never trace a different path
  // than the line/data point it's attached to (2026-07-02 desync fix).
  motionRef.current = {
    prevWin: prevWinRef.current,
    curWin,
    minSepPct,
    lanes: lanes.map((l) => ({
      id: l.id,
      samples: l.samples,
      prevTipData: prevTipData.current[l.id] || l.curTipData,
      curTipData: l.curTipData,
    })),
    markers: eventMarkers.map((mk) => ({ id: mk.id, t: mk.t, d: mk.d })),
  };

  // Subscribe the imperative writer once; tear the clock down on unmount.
  useEffect(() => {
    const clock = clockRef.current;
    const unsub = clock.subscribe((f) => {
      const m = motionRef.current;
      const pw = m.prevWin; const cw = m.curWin;
      // lin↔log crossfade from the absolute flip timestamp (LOG_TWEEN_MS).
      const target = logTargetRef.current;
      const tw = clamp01((perfNow() - logFlipAtRef.current) / LOG_TWEEN_MS);
      logMixRef.current = logMixAtFlipRef.current + (target - logMixAtFlipRef.current) * tw;
      const winF = {
        T: lerp(pw.T, cw.T, f),
        D: lerp(pw.D, cw.D, f),
        leaderM: lerp(pw.leaderM, cw.leaderM, f),
        kGap: lerp(pw.kGap, cw.kGap, f),
        mix: logMixRef.current,
      };
      const frameTips = [];
      m.lanes.forEach((l) => {
        const lineEl = lineEls.current[l.id];
        const areaEl = areaEls.current[l.id];
        const base = l.samples;
        let str = '';
        if (lineEl || areaEl) {
          for (let i = 0; i < base.length - 1; i++) {
            const p = mapPoint(base[i].t, base[i].d, winF);
            str += `${p.x.toFixed(1)},${p.y.toFixed(1)} `;
          }
        }
        const td = { t: lerp(l.prevTipData.t, l.curTipData.t, f), d: lerp(l.prevTipData.d, l.curTipData.d, f) };
        frameTips.push({ id: l.id, ...td });
        if (!lineEl && !areaEl) return;
        const tp = mapPoint(td.t, td.d, winF);
        const tipStr = `${tp.x.toFixed(1)},${tp.y.toFixed(1)}`;
        const lineStr = str ? `${str}${tipStr}` : tipStr;
        if (lineEl) lineEl.setAttribute('points', lineStr);
        if (areaEl) {
          const s0 = mapPoint(base[0].t, base[0].d, winF);
          areaEl.setAttribute('points', `${s0.x.toFixed(1)},${H} ${lineStr} ${tp.x.toFixed(1)},${H}`);
        }
      });

      // Tags/connectors: SAME formula as the tick-boundary layout (layoutTags),
      // fed the lerped tip + the live eased window — never a lerp between two
      // stale snapshots. This is what keeps a tag glued to its own line tip
      // through an active zoom instead of "catching up" after the fact.
      const frameTags = layoutTags(frameTips, winF, m.minSepPct);
      frameTags.forEach((t) => {
        const el = tagEls.current[t.id];
        if (el) { el.style.left = `${t.leftPct}%`; el.style.top = `${t.topPct}%`; }
        const connEl = connEls.current[t.id];
        if (connEl) {
          const displaced = Math.abs(t.topPct - t.rawTopPct) > 1.5;
          if (displaced) {
            connEl.style.display = '';
            connEl.style.left = `${t.leftPct}%`;
            connEl.style.top = `${Math.min(t.topPct, t.rawTopPct)}%`;
            connEl.style.height = `${Math.abs(t.topPct - t.rawTopPct)}%`;
          } else {
            connEl.style.display = 'none';
          }
        }
      });

      // Markers pin to a FIXED historical (t,d) — only the window moves them.
      m.markers.forEach((mk) => {
        const el = markerEls.current[mk.id];
        if (!el) return;
        const p = mapPoint(mk.t, mk.d, winF);
        el.style.left = `${(p.x / W) * 100}%`;
        el.style.top = `${(p.y / H) * 100}%`;
      });
    });
    return () => { unsub(); clock.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kick the clock on each new data tick so the lines/tags/markers glide to the
  // new datum (and the window eases prev→cur).
  useEffect(() => {
    clockRef.current.onTick(null);
  }, [tickKey]);

  // Kick the clock when the log mode flips so the crossfade animates even between
  // ticks (the flip aligns to a tick, but re-arm defensively).
  useEffect(() => {
    clockRef.current.onTick(null);
  }, [useLog]);

  return (
    <div className="cg-chart" data-testid="distance-chart">
      <div className="cg-chart__header" data-testid="chart-header">
        <span className="cg-chart__clock-label">{winCondition === 'time' ? 'Time left' : 'Elapsed'}</span>
        <span className="cg-chart__clock" data-testid="race-clock">{formatClock(clockSeconds)}</span>
        <span className="cg-chart__goal">
          {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : `Leader ${formatDistance(maxDistanceM)}`}
        </span>
        {/* Lives in the header, not the plot overlay — the plot's top-right corner
            is exactly where a leader's terminus tag sits in log mode (leader gap=0
            clamps to the layoutTags floor, ~11% from the top), so an absolutely-
            positioned chip there collided with it (2026-07-02 audit feedback). */}
        {useLog && (
          <span className="cg-chart__log-chip" data-testid="chart-log-chip">Zoomed on leaders</span>
        )}
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

        <g data-testid="chart-zoomable" className="cycle-race-screen__zoomable">

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

        {/* area fills (under each lane) — the tip point glides imperatively. */}
        {lanes.map((l) => {
          const area = `${l.startX.toFixed(1)},${H} ${l.pointsStr} ${l.tip.x.toFixed(1)},${H}`;
          return (
            <polygon
              key={`area-${l.id}`}
              ref={(el) => { areaEls.current[l.id] = el; }}
              points={area}
              fill={`url(#cg-fill-${l.idx})`}
              opacity={l.isGhost ? 0.4 : 1}
            />
          );
        })}

        {/* lane lines — a rider boxed at the start emerges from the axis; the whole
            line eases under the continuous window on the motion clock. */}
        {lanes.map((l) => (
          <polyline
            key={l.id}
            ref={(el) => { lineEls.current[l.id] = el; }}
            data-testid="race-line"
            points={l.pointsStr}
            fill="none"
            stroke={l.color}
            strokeWidth={l.isGhost ? 2 : 3}
            strokeDasharray={l.isGhost ? '5 6' : undefined}
            opacity={l.isGhost ? 0.8 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {distanceGoal && (
          <line className="cycle-race-screen__goal"
            x1={PAD_L} y1={yFor(goalM).toFixed(1)} x2={W - PAD_R} y2={yFor(goalM).toFixed(1)}
            vectorEffect="non-scaling-stroke" />
        )}

        </g>
      </svg>

      {/* HTML axis labels (dodge the non-uniform viewBox stretch). */}
      <div className="cg-chart__axis cg-chart__axis--y" data-testid="chart-axis-y">
        {yLabels.map((l) => (
          <span key={l.key} className="cg-chart__axis-label" style={{ top: `${l.topPct}%` }}>{l.text}</span>
        ))}
      </div>
      <div className="cg-chart__axis cg-chart__axis--x" data-testid="chart-axis-x">
        {xLabels.map((l) => (
          <span key={l.key} className="cg-chart__axis-label" style={{ left: `${l.leftPct}%` }}>{l.text}</span>
        ))}
      </div>

      {/* Goal line label — always present for a distance race, riding the top target line. */}
      {distanceGoal && (
        <div
          className="cycle-race-screen__goal-label"
          data-testid="chart-goal-label"
          style={{ top: `${(yFor(goalM) / H) * 100}%` }}
        >
          <span className="cycle-race-screen__goal-flag" aria-hidden="true"><RaceFlagIcon /></span> {formatDistance(goalM)}
        </div>
      )}

      {/* Terminus tags: each line's tip carries the rider's avatar + gap-behind-leader
          (the leader shows total distance). De-overlapped vertically; a connector
          links a displaced tag back to its true line endpoint. Positions glide. */}
      <div className="cycle-race-screen__tags" data-testid="chart-tags">
        {tagLayout.map((t) => {
          const displaced = Math.abs(t.topPct - t.rawTopPct) > 1.5;
          return displaced ? (
            <div
              key={`conn-${t.id}`}
              ref={(el) => { connEls.current[t.id] = el; }}
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
            ref={(el) => { tagEls.current[t.id] = el; }}
            className={`cycle-race-screen__tag${t.isGhost ? ' is-ghost' : ''}${t.isLeader ? ' is-leader' : ''}`}
            data-testid="chart-tag"
            style={{ left: `${t.leftPct}%`, top: `${t.topPct}%`, '--lane': t.color }}
          >
            <span className={`cycle-race-screen__tag-avatar${t.isGhost ? ' cg-ghost' : ''}`}>
              <img
                src={t.avatarSrc}
                alt=""
                data-testid="chart-tag-avatar"
                onError={(e) => { if (e.currentTarget.src !== FALLBACK_AVATAR) e.currentTarget.src = FALLBACK_AVATAR; }}
              />
            </span>
            <span className="cycle-race-screen__tag-gap" data-testid="chart-tag-gap">{t.gapText}</span>
          </div>
        ))}
      </div>

      {/* Officiating-event markers pinned to the lane where each fired. */}
      {eventMarkers.length > 0 && (
        <div className="cycle-race-screen__markers" data-testid="race-event-markers">
          {eventMarkers.map((m) => (
            <div
              key={`evt-${m.id}`}
              ref={(el) => { markerEls.current[m.id] = el; }}
              className={`cycle-race-screen__marker cycle-race-screen__marker--${m.type}`}
              data-testid={`race-event-marker-${m.type}`}
              style={{ left: `${m.leftPct}%`, top: `${m.topPct}%`, '--marker-color': m.color }}
            >
              <span className="cycle-race-screen__marker-glyph" aria-hidden="true">
                {m.Glyph ? <m.Glyph /> : null}
              </span>
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
