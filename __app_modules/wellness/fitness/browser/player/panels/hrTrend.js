// Whole-session heart-rate sparkline for tall rider cards: pure helpers.
// The series are the 5s timeline (one slot per tick, null while the strap is
// silent). Everything here is O(ticks) and runs once per tick per card.

export const TREND_MAX_BUCKETS = 120;
// A card shows its trend at >= ON px and hides it below OFF px, so a
// ResizeObserver wobble or a zone header appearing can't flicker it.
export const TREND_ON_PX = 116;
export const TREND_OFF_PX = 108;
// Single rider with a trend: the card grows into the roster's room so the
// chart fills it rather than leaving an empty band below a short card (owner
// decision 2026-10-23: taller is fine when the space is used well). The cap
// only stops absurd heights on very tall screens. Without a trend: 132.
export const TREND_SINGLE_CAP_PX = 560;

const ZONE_RANK = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
const rank = (zone) => (zone && Object.hasOwn(ZONE_RANK, zone) ? ZONE_RANK[zone] : -1);

export function trendVisible(wasVisible, cardHeight) {
  if (!Number.isFinite(cardHeight)) return false;
  return wasVisible ? cardHeight >= TREND_OFF_PX : cardHeight >= TREND_ON_PX;
}

// Mean of the non-null HR in each bucket and the bucket's HIGHEST zone, so a
// short Fire spike keeps its colour. A bucket with no reading stays null.
export function bucketHrSeries(hr, zones, maxBuckets = TREND_MAX_BUCKETS) {
  const length = Array.isArray(hr) ? hr.length : 0;
  if (!length) return [];
  const count = Math.min(length, maxBuckets);
  const buckets = [];
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * length) / count);
    const end = Math.floor(((b + 1) * length) / count);
    let sum = 0;
    let n = 0;
    let zone = null;
    for (let i = start; i < end; i++) {
      const value = hr[i];
      if (!Number.isFinite(value) || value <= 0) continue;
      sum += value;
      n++;
      const z = zones?.[i] ? String(zones[i]).toLowerCase() : null;
      if (rank(z) > rank(zone)) zone = z;
    }
    buckets.push(n ? { hr: sum / n, zone } : { hr: null, zone: null });
  }
  return buckets;
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

// One polyline per zone run, in a viewBox of width N (bucket count) by 100.
// A null bucket breaks the line (a dropout reads as a gap); a zone change
// starts the next run at the previous point so the colours join seamlessly.
export function hrTrendRuns(buckets, range) {
  if (!range || !buckets.length) return [];
  const [lo, hi] = range;
  const y = (v) => Math.round((100 - ((v - lo) / (hi - lo)) * 100) * 10) / 10;
  const x = (i) => i + 0.5;
  const runs = [];
  let current = null;
  let previousPoint = null;
  buckets.forEach((bucket, i) => {
    if (!Number.isFinite(bucket.hr)) { current = null; previousPoint = null; return; }
    const point = [x(i), y(bucket.hr)];
    if (!current || current.zone !== bucket.zone) {
      current = { zone: bucket.zone, points: previousPoint ? [previousPoint] : [] };
      runs.push(current);
    }
    current.points.push(point);
    previousPoint = point;
  });
  return runs
    .filter((run) => run.points.length >= 2)
    .map((run) => ({ zone: run.zone, points: run.points.map((p) => p.join(',')).join(' ') }));
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
