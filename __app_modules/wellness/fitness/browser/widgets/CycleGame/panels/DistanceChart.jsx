import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { LINE_COLORS } from "../../../lib/cycleGame/lineColors.js";
import { RaceFlagIcon } from "../home/icons.jsx";
import { plotStartIndex } from "../../../lib/cycleGame/chartTrim.js";
import getLogger from '@/lib/logging/Logger.js';
import { useFitGuard } from "./useFitGuard.js";
import { continuousWindow, evenTicks } from "../../../lib/cycleGame/chartZoom.js";
import { distanceAtTime } from "../../../lib/cycleGame/paceDelta.js";
import { rivalTraceSamples } from "../../../lib/cycleGame/rivalTrace.js";
import { formatClock } from "../../../lib/cycleGame/cycleGameLobby.js";
import { formatDistance } from "../../../lib/cycleGame/formatDistance.js";
import { gapFrac } from "../../../lib/cycleGame/chartScale.js";
import resolveParticipantIdentity from "../../../lib/cycleGame/participantIdentity.js";
import { createTickLerp } from "../../../../../../../__capabilities/gaming/browser/platform/realtime/index.js";
import "./DistanceChart.scss";

const X_BASE_S = 20;        // smallest time window (seconds; 1 sample = 1s at the 1Hz tick)
const Y_BASE_M = 150;       // smallest distance window (metres) for a TIME race's auto-zoom
const FILL_FRAC = 0.85;     // keep the leading data at ~85% of the window (the rest is headroom)
const GRID_LINES = 5;       // gridlines per axis, evenly spaced, both ends included
const AXIS_LABELS = 3;      // labels per axis: every other gridline (0, middle, end)
const TICK_INTERP_MS = 1000; // glide the leading edge over one 1Hz tick interval
const LOG_TWEEN_MS = 400;   // lin↔log flip crossfade duration (audit UX 2.7)
const MAX_PLOT_POINTS = 600; // decimate longer series to bound per-tick geometry cost
const FALLBACK_AVATAR = '/api/v1/static/img/users/user';
const PARKED_OPACITY = 0.4; // a parked rider's lane and tag recede, never vanish

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
 * the whole race (no Y zoom, ever); the time axis grows continuously. TIME races
 * show the whole race on X (0..timeCapS) from the first frame and auto-zoom Y
 * CONTINUOUSLY (no 2× rug-pulls); the lin↔log crowding flip crossfades over
 * ~400 ms with a "zoomed on leaders" chip. Axis gridlines and labels are evenly
 * spaced with both ends included (evenTicks).
 *
 * SOLO (`mode="solo"`): no "Leader" header, tags show own distance, linear only,
 * and the rival's whole recording is drawn as a dotted trace (rivalTrace).
 *
 * Motion (T6 architecture): the engine ticks at 1 Hz. Geometry is computed ONCE
 * per tick during render; the lane lines/areas, terminus tags and connectors
 * then GLIDE on a single shared linear rAF clock (tickLerp),
 * written imperatively. React never re-renders per animation frame. The line
 * remap eases the WINDOW bounds prev→cur across the tick, so a continuous zoom
 * reads as a smooth drift rather than a per-tick snap.
 *
 * Terminus tags carry a 28px rider avatar (ghost-treated) + gap-behind-leader
 * text; the leader's tag shows total distance.
 *
 * Parked riders (`riderLive[id].parked`: idle past the park window, or no
 * sensor) never set the framing: the leader the gaps are measured from, the
 * time-race distance window and the log-scale crowding test all use the
 * un-parked riders (everyone, if the whole field is parked). A parked lane and
 * its tag draw at reduced opacity; the tag shows the rider's own distance. Axis labels are an HTML overlay
 * (≥1.1rem): distance up the Y axis (gap-behind-leader in log mode), m:ss across X.
 */
export default function DistanceChart({ riderIds, riders, riderLive, winCondition, goalM, zoneBox, elapsedS = 0, clockSeconds = 0, maxDistanceM = 0, mode = 'sidebar', timeCapS = null }) {
  // Solo: one live rider and a rival. Nobody leads: no "Leader" in the header,
  // and each tag shows the rider's own distance rather than a gap to a leader.
  // The rival's WHOLE recording is drawn as a dashed trace, so the rider sees
  // where the rival will be; the scale stays linear (see useLog below).
  const solo = mode === 'solo';
  const rivalId = solo
    ? riderIds.find((id) => riders[id].isGhost && Array.isArray(riders[id].ghostRecordedSeries) && riders[id].ghostRecordedSeries.length) ?? null
    : null;
  const rivalSeries = rivalId ? riders[rivalId].ghostRecordedSeries : null;
  const rivalIntervalS = rivalId ? riders[rivalId].ghostIntervalS : null;
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

  const isParked = (id) => !!(riderLive && riderLive[id] && riderLive[id].parked);
  const unparkedIds = riderIds.filter((id) => !isParked(id));
  const framingIds = unparkedIds.length ? unparkedIds : riderIds;
  const leaderDistanceM = Math.max(0, ...framingIds.map((id) => riders[id].cumulativeDistanceM || 0));
  const maxSeriesLen = Math.max(1, ...riderIds.map((id) => (riders[id].distanceSeries || []).length));

  // Distance races have a fixed finish: pin the Y window to the goal so the goal
  // line sits at the TOP and lanes climb toward it the whole race.
  const distanceGoal = winCondition === 'distance' && Number.isFinite(goalM) && goalM > 0;

  // ── Windows ────────────────────────────────────────────────────────────────
  // Time axis: a TIME race shows the whole race (0 … timeCapS) from the first
  // frame, so the rider sees how much is left. A distance race has no fixed end
  // time, so its time axis grows continuously to hold elapsed at ~85% of the
  // window. Distance axis: FIXED to the goal for a distance race; continuous
  // auto-zoom to fit the leader for a time race, never below the solo rival's
  // final distance (so its whole trace is on screen). Monotonic (only zoom out)
  // against sensor jitter via refs.
  const fixedTime = winCondition === 'time' && Number.isFinite(timeCapS) && timeCapS > 0;
  const timeWinRef = useRef(X_BASE_S);
  const distWinRef = useRef(Y_BASE_M);
  const winT = fixedTime
    ? timeCapS
    : Math.max(timeWinRef.current, continuousWindow(elapsedS, { base: X_BASE_S, fillFrac: FILL_FRAC }));
  timeWinRef.current = winT;
  let winD;
  if (distanceGoal) {
    winD = goalM;
  } else {
    const rivalFinalM = rivalSeries && fixedTime ? distanceAtTime(rivalSeries, timeCapS, rivalIntervalS) : 0;
    winD = Math.max(distWinRef.current, rivalFinalM, continuousWindow(leaderDistanceM, { base: Y_BASE_M, fillFrac: FILL_FRAC }));
    distWinRef.current = winD;
  }

  // ── Lin↔log crowding transform (TIME races only) ───────────────────────────
  // A distance race keeps its truthful fixed-linear scale (goal at top). A time
  // race switches to a leader-anchored gap-log when adjacent leaders bunch, with
  // hysteresis so it doesn't flap; the flip crossfades (logMix) over LOG_TWEEN_MS.
  const lastDists = framingIds.map((id) => (riders[id].distanceSeries || []).slice(-1)[0] || 0);
  const leaderM = lastDists.length ? Math.max(...lastDists) : 0;
  const K_GAP = 4;
  const K_GAP_FRAC = 0.5;
  const logRef = useRef(false);
  // Solo stays linear: the log scale is anchored on the leader, which would
  // bend the rival's whole-race trace out of shape ahead of the rider.
  if (!distanceGoal && !solo && framingIds.length >= 2) {
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
      parked: isParked(id),
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
  }), [riderIds, riders, riderLive, maxSeriesLen, elapsedS, winT, winD, useLog, goalM, winCondition, chartH]).filter(Boolean);

  // ── Solo rival trace: the rival's whole recording inside the window ────────
  // (time race: the whole race; distance race: up to the window edge, ending on
  // the goal line at the rival's finish time). Re-sampled per frame under the
  // eased window below, so it drifts with the lanes during a zoom.
  const traceGoalM = distanceGoal ? goalM : null;
  const traceSamplesFor = (windowS) => (rivalSeries
    ? rivalTraceSamples(rivalSeries, rivalIntervalS, { windowS, goalM: traceGoalM, maxPoints: MAX_PLOT_POINTS })
    : []);
  const traceSamples = traceSamplesFor(winT);
  const traceColor = rivalId ? LINE_COLORS[riderIds.indexOf(rivalId) % LINE_COLORS.length] : null;
  const tracePoints = ptsStr(traceSamples.map((p) => mapPoint(p.t, p.d, curWin)));

  // leader (for emphasis / gap) — furthest along among the un-parked riders
  const leaderId = framingIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );
  const leaderDistM = leaderId != null ? (riders[leaderId].cumulativeDistanceM || 0) : 0;
  // The header's "Leader …" is the furthest rider overall (parked or not) —
  // printed from that rider's own engine distance so it matches their other readouts.
  const headerLeaderId = riderIds.reduce(
    (best, id) => (best == null || (riders[id].cumulativeDistanceM || 0) > (riders[best].cumulativeDistanceM || 0) ? id : best),
    null
  );

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
    const parked = isParked(id);
    const ident = resolveParticipantIdentity(riders[id].userId || id, riders[id].displayName);
    const avatarSrc = (riderLive[id] || {}).avatarSrc || riders[id].avatarSrc || ident.avatarSrc || FALLBACK_AVATAR;
    const showsOwnDistance = solo || isLeader || parked;
    const gapText = showsOwnDistance
      ? formatDistance(distanceM)
      : `−${formatDistance(Math.max(0, leaderDistM - distanceM))}`;
    return {
      id, idx, leftPct: p.leftPct, rawTopPct: p.rawTopPct, topPct: p.topPct,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      isGhost: !!riders[id].isGhost,
      parked,
      avatarSrc, distanceM, displayName: riders[id].displayName, gapText, isLeader, showsOwnDistance
    };
  });

  // Gridlines + HTML axis labels (≥1.1rem). Y: distance values (gap-behind-leader
  // in log mode); X: m:ss. Evenly spaced over the window with both ends
  // included (evenTicks); the labels sit on every other gridline.
  const xGrid = evenTicks(0, winT, GRID_LINES).map((t) => ({ t, x: xForTime(t) }));
  const yGrid = evenTicks(0, winD, GRID_LINES).map((d) => ({ d, y: yFor(d) }));
  const xLabels = evenTicks(0, winT, AXIS_LABELS).map((t) => ({
    key: `xl-${t}`, leftPct: (xForTime(t) / W) * 100, text: formatClock(t)
  }));
  const yLabels = evenTicks(0, winD, AXIS_LABELS).map((d) => ({
    key: `yl-${d}`,
    topPct: (yFor(d) / H) * 100,
    text: useLog ? (d >= leaderM ? '0' : `−${formatDistance(Math.max(0, leaderM - d))}`) : formatDistance(d)
  }));

  // ── One shared motion clock: eased window remap + tags / connectors ─
  const lineEls = useRef({});
  const areaEls = useRef({});
  const tagEls = useRef({});
  const connEls = useRef({});
  const traceEl = useRef(null);
  const motionRef = useRef({ lanes: [], tags: [], conns: [], prevWin: curWin, curWin });
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
  // resize/rescale re-render is picked up without a stale closure). Tags carry
  // only IDENTITY + raw tip data here — their SCREEN POSITION is
  // recomputed fresh every frame in the subscriber below (via layoutTags /
  // mapPoint under the live eased window), not lerped between two stale
  // per-tick percentages, so a tag can never trace a different path
  // than the line/data point it's attached to (2026-07-02 desync fix).
  motionRef.current = {
    prevWin: prevWinRef.current,
    curWin,
    minSepPct,
    traceFor: rivalSeries ? traceSamplesFor : null,
    lanes: lanes.map((l) => ({
      id: l.id,
      samples: l.samples,
      prevTipData: prevTipData.current[l.id] || l.curTipData,
      curTipData: l.curTipData,
    })),
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
      if (traceEl.current && m.traceFor) {
        const pts = m.traceFor(winF.T).map((p) => mapPoint(p.t, p.d, winF));
        traceEl.current.setAttribute('points', ptsStr(pts));
      }
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

    });
    return () => { unsub(); clock.stop(); };
     
  }, []);

  // Kick the clock on each new data tick so the lines/tags glide to the
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
          {winCondition === 'distance' ? `to ${formatDistance(goalM)}` : solo ? null : (
            <>Leader <span data-distance-readout={headerLeaderId ?? undefined}>
              {formatDistance(headerLeaderId != null ? riders[headerLeaderId].cumulativeDistanceM : maxDistanceM)}
            </span></>
          )}
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

        {/* Solo: the rival's whole recording, dotted, under every lane. Its
            replayed lane and tag still mark where the rival is now. */}
        {rivalId && traceSamples.length > 1 && (
          <polyline
            ref={traceEl}
            data-testid="rival-trace"
            className="cycle-race-screen__rival-trace"
            points={tracePoints}
            fill="none"
            stroke={traceColor}
            strokeWidth={2}
            strokeDasharray="2 7"
            opacity={0.55}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* area fills (under each lane) — the tip point glides imperatively. */}
        {lanes.map((l) => {
          const area = `${l.startX.toFixed(1)},${H} ${l.pointsStr} ${l.tip.x.toFixed(1)},${H}`;
          return (
            <polygon
              key={`area-${l.id}`}
              ref={(el) => { areaEls.current[l.id] = el; }}
              points={area}
              fill={`url(#cg-fill-${l.idx})`}
              opacity={(l.isGhost ? 0.4 : 1) * (l.parked ? PARKED_OPACITY : 1)}
            />
          );
        })}

        {/* lane lines — a late starter emerges from the axis; the whole
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
            opacity={l.parked ? PARKED_OPACITY : (l.isGhost ? 0.8 : 1)}
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
            className={`cycle-race-screen__tag${t.isGhost ? ' is-ghost' : ''}${t.isLeader ? ' is-leader' : ''}${t.parked ? ' is-parked' : ''}`}
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
            <span className="cycle-race-screen__tag-gap" data-testid="chart-tag-gap"
              data-distance-readout={t.showsOwnDistance ? t.id : undefined}>{t.gapText}</span>
          </div>
        ))}
      </div>

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
  zoneBox: PropTypes.shape({ width: PropTypes.number, height: PropTypes.number }),
  elapsedS: PropTypes.number,
  clockSeconds: PropTypes.number,
  maxDistanceM: PropTypes.number,
  mode: PropTypes.oneOf(['solo', 'sidebar', 'wide']),
  /** Time races: the race length; the x axis spans 0 … timeCapS from the first frame. */
  timeCapS: PropTypes.number,
};
