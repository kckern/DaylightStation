//
// Sparkline geometry and trend arithmetic for the weight chip. Pure, and in its
// own file for the same reason dayBars.js is: jsdom cannot measure an SVG, so
// the only honest thing a test can assert is the number the component computes
// and hands to the DOM.
//
// Two series, deliberately: the RAW daily readings (noisy — a scale reads three
// pounds of water weight) and `lbs_adjusted_average` (the smoothed line the
// budget itself is computed from). Showing only the smooth line hides how noisy
// the input is; showing only the raw line invites reading noise as progress.

/** Chart box in user units. preserveAspectRatio="none" stretches it to the CSS box. */
export const VIEW_W = 100;
export const VIEW_H = 28;

// A flat series would divide by zero when normalizing. 0.5 lb is the smallest
// spread worth spreading across the full height — below it the line stays
// visually flat, which is the truth.
const MIN_SPAN_LBS = 0.5;

// A date must be a real calendar date, not merely YYYY-MM-DD shaped: "2026-08-32"
// passes the regex and then throws RangeError the moment the trend window is
// computed off it. A garbage row on disk is skipped, never fatal.
// Two distinct failure modes, both real: "2026-08-32" parses to Invalid Date
// (toISOString would THROW), while "2026-02-31" quietly normalizes to March 3
// (toISOString returns the wrong day). The NaN guard covers the first, the
// round-trip the second.
const isCalendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @param {object} weightData - the /health/weight payload: { [date]: entry }
 * @param {{days?: number, trendDays?: number}} opts
 * @returns {{
 *   entries: Array, latest: object|null, latestLbs: number|null,
 *   deltaLbs: number|null, direction: 'up'|'down'|'flat'|null,
 *   trendFrom: string|null, rawPoints: string, avgPoints: string
 * }}
 *   `deltaLbs` compares the ADJUSTED AVERAGE now against the adjusted average
 *   `trendDays` ago — never raw against raw, which would report yesterday's
 *   salt as a trend. A null delta means the history is too short to have one,
 *   and the chip must say so rather than print a confident 0.0.
 */
export function buildWeightSeries(weightData, { days = 30, trendDays = 7 } = {}) {
  const all = Object.entries(weightData || {})
    .filter(([date, e]) => isCalendarDate(date) && e && typeof e === 'object')
    .map(([date, e]) => ({ date, lbs: num(e.lbs ?? e.measurement), avg: num(e.lbs_adjusted_average) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const entries = all.slice(-days);
  const latest = entries.length ? entries[entries.length - 1] : null;
  const latestLbs = latest ? (latest.avg ?? latest.lbs) : null;

  // The comparison point is the LAST entry dated on or before (latest - trendDays).
  // "Nearest at or before" rather than "exactly that date": readings are not
  // guaranteed daily, and inventing a value for a missing day would be a
  // measurement nobody took.
  let deltaLbs = null; let direction = null; let trendFrom = null;
  if (latest && latest.avg != null) {
    const cutoff = new Date(`${latest.date}T12:00:00Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - trendDays);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    let prior = null;
    for (const e of all) {
      if (e.date > cutoffISO) break;
      if (e.avg != null) prior = e;
    }
    if (prior && prior.date !== latest.date) {
      deltaLbs = Math.round((latest.avg - prior.avg) * 10) / 10;
      direction = deltaLbs > 0 ? 'up' : (deltaLbs < 0 ? 'down' : 'flat');
      trendFrom = prior.date;
    }
  }

  // Both series share ONE vertical scale — two independent scales would make
  // the raw line and the average line cross where they do not.
  const values = entries.flatMap((e) => [e.lbs, e.avg]).filter((v) => v != null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 0;
  const span = Math.max(hi - lo, MIN_SPAN_LBS);
  const mid = (hi + lo) / 2;
  const top = mid + span / 2;

  const x = (i) => (entries.length < 2 ? VIEW_W / 2 : (i / (entries.length - 1)) * VIEW_W);
  const y = (v) => ((top - v) / span) * VIEW_H;
  const round = (n) => Math.round(n * 100) / 100;
  const toPoints = (key) => entries
    .map((e, i) => (e[key] == null ? null : `${round(x(i))},${round(y(e[key]))}`))
    .filter(Boolean)
    .join(' ');

  return {
    entries,
    latest,
    latestLbs,
    deltaLbs,
    direction,
    trendFrom,
    // A single point is not a line: one reading draws nothing rather than a
    // horizontal bar implying a week of stability.
    rawPoints: entries.length >= 2 ? toPoints('lbs') : '',
    avgPoints: entries.length >= 2 ? toPoints('avg') : '',
  };
}

/** "171.6" / "—". One decimal: a bathroom scale's real resolution. */
export const fmtLbs = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : (Math.round(Number(v) * 10) / 10).toFixed(1));

/** "+0.4" / "-1.2" / "0.0" — the sign is always explicit for a delta. */
export const fmtDelta = (v) => {
  if (v == null || !Number.isFinite(Number(v))) return null;
  const n = Math.round(Number(v) * 10) / 10;
  return `${n > 0 ? '+' : (n < 0 ? '−' : '±')}${Math.abs(n).toFixed(1)}`;
};
