/**
 * Lane geometry: time onto a 0..1000 viewBox. The strip SVGs stretch that box
 * to whatever width the lane has (`preserveAspectRatio="none"`), so every
 * shape is computed once in viewBox units and never re-measured.
 */

export const W = 1000;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 10) / 10;

/** The x of an instant inside a window, clamped to the strip. */
export function xOf(tMs, { startMs, endMs }) {
  const span = endMs - startMs;
  if (!(span > 0)) return 0;
  return clamp(((tMs - startMs) / span) * W, 0, W);
}

/**
 * An area path for a reading (watts): one closed shape per run of readings,
 * a `null` reading (unavailable, unknown) breaking the run so a gap reads as
 * a gap, never as a zero.
 */
export function linePath(points, window, { height, maxV }) {
  const top = maxV > 0 ? maxV : 1;
  const yOf = (v) => round(height - clamp(v / top, 0, 1) * height);
  const runs = [];
  let run = [];
  for (const p of points || []) {
    if (p == null || p.v == null || !Number.isFinite(p.v)) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length) runs.push(run);
  return runs.map((r) => {
    const xs = r.map((p) => round(xOf(p.t, window)));
    // A lone reading is still a sliver, not nothing.
    if (r.length === 1) xs.push(Math.min(W, xs[0] + 1));
    const ys = r.map((p) => yOf(p.v));
    if (r.length === 1) ys.push(ys[0]);
    const line = xs.map((x, i) => `L${x} ${ys[i]}`).join(' ');
    return `M${xs[0]} ${height} ${line} L${xs[xs.length - 1]} ${height} Z`;
  }).join(' ');
}

/** On-intervals as bars; the shortest still one unit wide, so it shows. */
export function intervalRects(intervals, window) {
  return (intervals || []).map(({ from, to }) => {
    const x = xOf(from, window);
    return { x, width: Math.max(1, xOf(to, window) - x) };
  });
}

/** Ring instants as x positions. */
export function markXs(marks, window) {
  return (marks || []).map((t) => xOf(t, window));
}

const partsCache = new Map();
function localParts(tMs, timeZone) {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
    partsCache.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(tMs));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

const TICK_LABELS = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' };
const QUARTER_HOUR = 15 * 60_000;

/** Local 12a / 6a / 12p / 6p inside a day window (so a DST day spaces them truly). */
export function hourTicks(window, timeZone) {
  const ticks = [];
  const seen = new Set();
  const first = Math.ceil(window.startMs / QUARTER_HOUR) * QUARTER_HOUR;
  for (let t = first; t < window.endMs; t += QUARTER_HOUR) {
    const { hour, minute } = localParts(t, timeZone);
    const label = minute === 0 ? TICK_LABELS[hour] : undefined;
    if (label && !seen.has(label)) {
      seen.add(label);
      ticks.push({ x: xOf(t, window), label });
    }
  }
  return ticks;
}

/**
 * A timeline day as a strip window. The server ends today's day at "now";
 * the strip spans the whole local day (to the coming midnight, 23–25 h on a
 * DST day) and carries `nowMs` so the future reads as not-yet.
 */
export function dayWindow({ startIso, endIso }, timeZone) {
  const startMs = Date.parse(startIso);
  const endRaw = Date.parse(endIso);
  let midnight = startMs + 24 * 3_600_000;
  const { hour, minute } = localParts(midnight, timeZone);
  const sinceMidnight = hour * 60 + minute;
  midnight += sinceMidnight > 12 * 60 ? (1440 - sinceMidnight) * 60_000 : -sinceMidnight * 60_000;
  if (endRaw >= midnight - 1000) return { startMs, endMs: endRaw, nowMs: null };
  return { startMs, endMs: midnight, nowMs: endRaw };
}
