/**
 * historySeries — shapes raw entity history into what the dashboard draws.
 *
 * A series is an ascending `Array<{t: epochMs, v: number|string|null}>`; each
 * value holds (a step function) until the next point, and `null` means the
 * entity was unavailable. Everything here is pure: no clock, no I/O.
 *
 * @module home-automation/historySeries
 */

const HOUR_MS = 3600e3;
const RESET_TAIL_MS = 10 * 60e3;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function zonedParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const o = {};
  for (const p of parts) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Epoch ms of the local midnight that starts the day containing `ms`.
 * DST-safe: the zone offset is corrected a second time at the first guess.
 */
export function localMidnight(ms, timeZone) {
  const { year, month, day } = zonedParts(ms, timeZone);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return second;
}

function dayLabel(ms, timeZone) {
  const { year, month, day } = zonedParts(ms, timeZone);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Local-day windows for a range: `today` is [midnight, now], `yesterday` one
 * full day, `week` seven days oldest first with today (partial) last.
 */
export function dayWindows(range, { nowMs, timeZone }) {
  const todayStart = localMidnight(nowMs, timeZone);
  const today = { day: dayLabel(todayStart, timeZone), startMs: todayStart, endMs: nowMs };
  if (range === 'today') return [today];
  if (range === 'yesterday') {
    const startMs = localMidnight(todayStart - 1, timeZone);
    return [{ day: dayLabel(startMs, timeZone), startMs, endMs: todayStart }];
  }
  if (range === 'week') {
    const out = [today];
    let end = todayStart;
    for (let i = 0; i < 6; i += 1) {
      const startMs = localMidnight(end - 1, timeZone);
      out.unshift({ day: dayLabel(startMs, timeZone), startMs, endMs: end });
      end = startMs;
    }
    return out;
  }
  throw new Error(`dayWindows: unknown range "${range}"`);
}

/**
 * Step-function segments clipped to the window. The last point at or before
 * `startMs` carries in; nothing is known before the first point.
 */
function segments(series, startMs, endMs) {
  const out = [];
  if (!Array.isArray(series) || endMs <= startMs) return out;
  let i = 0;
  let carry = -1;
  while (i < series.length && series[i].t <= startMs) { carry = i; i += 1; }
  let idx = carry >= 0 ? carry : i;
  for (; idx < series.length; idx += 1) {
    const from = Math.max(series[idx].t, startMs);
    if (from >= endMs) break;
    const to = idx + 1 < series.length ? Math.min(series[idx + 1].t, endMs) : endMs;
    if (to > from) out.push({ from, to, v: series[idx].v });
  }
  return out;
}

/**
 * True when the entity held a known (non-null) value at some instant inside
 * the window, including a value carried in from before `startMs`. A window
 * before the first point, or one the entity spent unavailable, has none.
 */
export function hasKnownValue(series, { startMs, endMs }) {
  return segments(series, startMs, endMs).some((seg) => seg.v !== null && seg.v !== undefined);
}

/**
 * Down-samples a numeric series to a fixed bucket count. `v` is the
 * time-weighted mean of the held value, `max` the peak; unavailable time is
 * excluded, and a bucket with no numeric time is `{v: null, max: null}`.
 */
export function bucketLine(series, { startMs, endMs, buckets }) {
  const width = (endMs - startMs) / buckets;
  const sum = new Array(buckets).fill(0);
  const span = new Array(buckets).fill(0);
  const max = new Array(buckets).fill(null);
  for (const seg of segments(series, startMs, endMs)) {
    if (!isNum(seg.v)) continue;
    const first = Math.max(0, Math.floor((seg.from - startMs) / width));
    const last = Math.min(buckets - 1, Math.floor((seg.to - startMs - 1e-9) / width));
    for (let b = first; b <= last; b += 1) {
      const from = Math.max(seg.from, startMs + b * width);
      const to = Math.min(seg.to, startMs + (b + 1) * width);
      if (to <= from) continue;
      sum[b] += seg.v * (to - from);
      span[b] += to - from;
      max[b] = max[b] === null ? seg.v : Math.max(max[b], seg.v);
    }
  }
  return Array.from({ length: buckets }, (_, b) => ({
    t: startMs + b * width,
    v: span[b] > 0 ? sum[b] / span[b] : null,
    max: span[b] > 0 ? max[b] : null,
  }));
}

/**
 * Spans where `isOn(value)` held, clipped to the window; `null` counts as
 * off, and gaps no longer than `mergeGapMs` are bridged.
 */
export function toIntervals(series, { startMs, endMs, isOn, mergeGapMs = 120000 }) {
  const out = [];
  for (const seg of segments(series, startMs, endMs)) {
    if (seg.v === null || seg.v === undefined || !isOn(seg.v)) continue;
    const last = out[out.length - 1];
    if (last && seg.from - last.to <= mergeGapMs) last.to = seg.to;
    else out.push({ from: seg.from, to: seg.to });
  }
  return out;
}

/**
 * Times of off -> on changes strictly inside the window. A value already on
 * at `startMs` and an unknown (`null`) -> on are not edges.
 */
export function risingEdges(series, { startMs, endMs, isOn }) {
  const edges = [];
  if (!Array.isArray(series)) return edges;
  let prev; // undefined = nothing known yet
  for (const p of series) {
    if (p.t <= startMs) { prev = p.v; continue; }
    if (p.t >= endMs) break;
    if (prev !== undefined && prev !== null && !isOn(prev) && p.v !== null && isOn(p.v)) edges.push(p.t);
    prev = p.v;
  }
  return edges;
}

/** Total length in ms of a list of `{from, to}` intervals. */
export function sumIntervalsMs(intervals) {
  return intervals.reduce((n, iv) => n + (iv.to - iv.from), 0);
}

/**
 * Final value of a counter that resets at local midnight (`*_energy_today`).
 * Only points inside the window count (a carried-in pre-reset value is
 * ignored); a reset within the last 10 minutes yields the value before it.
 * `null` when there is no numeric point.
 */
export function dailyCounterTotal(series, { startMs, endMs }) {
  const pts = (series || []).filter((p) => p.t >= startMs && p.t < endMs && isNum(p.v));
  if (!pts.length) return null;
  for (let j = pts.length - 1; j > 0; j -= 1) {
    if (pts[j].v < pts[j - 1].v) {
      return pts[j].t >= endMs - RESET_TAIL_MS ? pts[j - 1].v : pts[pts.length - 1].v;
    }
  }
  return pts[pts.length - 1].v;
}

/**
 * Growth of a `total_increasing` meter inside the window: the sum of
 * positive increments. A decrease is a meter reset, so the new value counts
 * as an increment from zero. `null` when there is no numeric point.
 */
export function counterDelta(series, { startMs, endMs }) {
  let prev = null;
  let total = 0;
  let seen = false;
  for (const p of series || []) {
    if (p.t >= endMs) break;
    if (!isNum(p.v)) continue;
    seen = true;
    if (p.t <= startMs) { prev = p.v; continue; }
    if (prev !== null) total += p.v >= prev ? p.v - prev : p.v;
    prev = p.v;
  }
  return seen ? total : null;
}

/**
 * Integrates a watts step function to kWh over the window, skipping
 * unavailable time. `null` when no numeric time was observed.
 */
export function integrateKwh(series, { startMs, endMs }) {
  let wattMs = 0;
  let any = false;
  for (const seg of segments(series, startMs, endMs)) {
    if (!isNum(seg.v)) continue;
    any = true;
    wattMs += seg.v * (seg.to - seg.from);
  }
  return any ? wattMs / HOUR_MS / 1000 : null;
}
