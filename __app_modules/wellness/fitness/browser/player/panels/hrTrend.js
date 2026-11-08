// Whole-session heart-rate sparkline for tall rider cards: pure helpers.
// The series is the 5s timeline (one slot per tick, null while the strap is
// silent); hrTrendScale.js samples it onto the log time axis. Paths are drawn
// in (x 0..100, bpm) user space and trendTransform maps bpm onto the viewBox.
import { ZONE_COLORS } from '../../shared/constants/fitness.js';

// A card shows its trend at >= ON px and hides it below OFF px, so a
// ResizeObserver wobble or a zone header appearing can't flicker it.
export const TREND_ON_PX = 116;
export const TREND_OFF_PX = 108;
// Single rider with a trend: the card grows into the roster's room so the
// chart fills it rather than leaving an empty band below a short card (owner
// decision 2026-10-23: taller is fine when the space is used well). The cap
// only stops absurd heights on very tall screens. Without a trend: 132.
export const TREND_SINGLE_CAP_PX = 560;
// Below this many real readings the card shows a collecting spinner instead
// of a line too sparse to read. Readings, not ticks: a dropout doesn't count.
export const TREND_MIN_READINGS = 5;
// Zone bands are open-ended in practice: the outer bands reach these bounds.
const BAND_FLOOR = 0;
const BAND_CEILING = 400;
const NEUTRAL = 'rgba(255,255,255,0.6)';

export function trendVisible(wasVisible, cardHeight) {
  if (!Number.isFinite(cardHeight)) return false;
  return wasVisible ? cardHeight >= TREND_OFF_PX : cardHeight >= TREND_ON_PX;
}

export function trendReady(prefix) {
  return Boolean(prefix) && prefix.count[prefix.length] >= TREND_MIN_READINGS;
}

// Stable per-rider y-range: the rider's own zone thresholds bound it, and it
// widens only when the data leaves them, so the line doesn't jump each tick.
export function hrTrendRange(buckets, thresholds = []) {
  const values = buckets.map((b) => b.hr).filter(Number.isFinite);
  const marks = thresholds.filter((t) => Number.isFinite(t) && t > 0);
  if (!values.length && !marks.length) return null;
  const lowMark = marks.length ? Math.min(...marks) - 10 : Infinity;
  const highMark = marks.length ? Math.max(...marks) + 10 : -Infinity;
  let lo = Math.min(lowMark, ...values);
  let hi = Math.max(highMark, ...values);
  if (!marks.length) { lo -= 5; hi += 5; }
  if (hi - lo < 20) { const mid = (hi + lo) / 2; lo = mid - 10; hi = mid + 10; }
  return [lo, hi];
}

const r2 = (v) => Math.round(v * 100) / 100;

// Monotone cubic (Fritsch–Carlson) through each run of non-null points, so the
// line is smooth but never overshoots a reading. A null starts a new subpath
// (a dropout reads as a gap); a lone point is a dot under the round cap.
export function monotonePath(points) {
  const runs = [];
  let run = [];
  for (const p of points || []) {
    if (Number.isFinite(p?.hr)) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.map(runPath).join(' ');
}

function runPath(run) {
  const n = run.length;
  const head = `M${r2(run[0].x)},${r2(run[0].hr)}`;
  if (n === 1) return `${head} h0.01`;
  if (n === 2) return `${head} L${r2(run[1].x)},${r2(run[1].hr)}`;
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = run[i + 1].x - run[i].x;
    m[i] = dx[i] > 0 ? (run[i + 1].hr - run[i].hr) / dx[i] : 0;
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) { t[i] = 0; continue; }
    const w1 = 2 * dx[i] + dx[i - 1];
    const w2 = dx[i] + 2 * dx[i - 1];
    t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = head;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const a = run[i];
    const b = run[i + 1];
    d += ` C${r2(a.x + h)},${r2(a.hr + t[i] * h)} ${r2(b.x - h)},${r2(b.hr - t[i + 1] * h)} ${r2(b.x)},${r2(b.hr)}`;
  }
  return d;
}

// One band per zone, threshold to next threshold in bpm. The line is clipped
// to each band and stroked in its colour, so the colour changes exactly where
// the line crosses a threshold, mid-segment included.
export function zoneBands(zoneSequence) {
  const zones = (Array.isArray(zoneSequence) ? zoneSequence : [])
    .filter((z) => Number.isFinite(z?.threshold))
    .slice()
    .sort((a, b) => a.threshold - b.threshold);
  if (!zones.length) return [{ id: 'none', color: NEUTRAL, lo: BAND_FLOOR, hi: BAND_CEILING }];
  return zones.map((z, i) => ({
    id: String(z.id),
    color: ZONE_COLORS[String(z.id).toLowerCase()] || z.color || NEUTRAL,
    lo: i === 0 ? BAND_FLOOR : z.threshold,
    hi: i === zones.length - 1 ? BAND_CEILING : zones[i + 1].threshold,
  }));
}

// Maps bpm user space onto viewBox y: hi → 0, lo → 100. x passes through.
export function trendTransform([lo, hi]) {
  const a = -100 / (hi - lo);
  const b = (100 * hi) / (hi - lo);
  return `matrix(1 0 0 ${+a.toFixed(4)} 0 ${+b.toFixed(4)})`;
}

export function thresholdLines(range, thresholds = []) {
  if (!range) return [];
  const [lo, hi] = range;
  return thresholds
    .filter((t) => Number.isFinite(t) && t > lo && t < hi)
    .map((t) => Math.round((100 - ((t - lo) / (hi - lo)) * 100) * 10) / 10);
}

// Fire has no next zone, so the progress bar would be an empty track. On
// committed Fire it renders full and pulses instead.
export function zoneBarState({ committedZoneId, showBar, progress }) {
  if (committedZoneId === 'fire') return { show: true, max: true, percent: 100 };
  if (!showBar && progress == null) return { show: false, max: false, percent: 0 };
  const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return { show: true, max: false, percent: Math.round(p * 100) };
}
