// Log time axis for the rider HR trend: the recent past gets most of the width,
// older history is compressed toward the left edge. Ages and spans are in
// timeline ticks (5s each). x runs 0..1 here (1 = now) and 0..100 in samples.

// Ages under ~k ticks read near-linear; past it they compress logarithmically.
// 12 ticks = 1 minute: on a 30-minute ride the last minute takes ~20% of the
// width and the last five ~52%; a short session stays close to linear.
export const TREND_RECENT_TICKS = 12;
// Screen slots for older history. Each tick falls in exactly one slot, so the
// output never exceeds this however long the session runs.
export const TREND_SLOTS = 120;

export function logX(age, span, k = TREND_RECENT_TICKS) {
  if (!(span > 0)) return 1;
  const a = Math.min(Math.max(age, 0), span);
  return 1 - Math.log1p(a / k) / Math.log1p(span / k);
}

export function ageAtX(x, span, k = TREND_RECENT_TICKS) {
  if (!(span > 0)) return 0;
  const clamped = Math.min(Math.max(x, 0), 1);
  return k * Math.expm1((1 - clamped) * Math.log1p(span / k));
}

// Prefix sums of the real readings (finite, > 0) so any index range averages
// in O(1). Built once per tick; sampled every frame.
export function buildPrefix(hr) {
  const length = Array.isArray(hr) ? hr.length : 0;
  const sum = new Float64Array(length + 1);
  const count = new Uint32Array(length + 1);
  for (let i = 0; i < length; i++) {
    const value = hr[i];
    const real = Number.isFinite(value) && value > 0;
    sum[i + 1] = sum[i] + (real ? value : 0);
    count[i + 1] = count[i] + (real ? 1 : 0);
  }
  return { sum, count, length };
}

// One point per non-empty screen slot, ascending x in 0..100. `head` is the
// fractional tick index treated as now; indices past `lastIndex` are left for
// the caller's animated tip. A slot whose ticks hold no reading is a null
// point (a gap); a slot that covers no tick at all emits nothing.
export function sampleTrend(prefix, { head, lastIndex, slots = TREND_SLOTS }) {
  const last = Math.min(lastIndex, prefix.length - 1);
  if (!(last >= 0) || !Number.isFinite(head)) return [];
  const span = Math.max(head, 0);
  // Shared slot edges in index space, so no tick lands in two slots.
  const edges = new Float64Array(slots + 1);
  edges[0] = -1;
  edges[slots] = head;
  for (let s = 1; s < slots; s++) edges[s] = head - ageAtX(s / slots, span);
  const points = [];
  for (let s = 0; s < slots; s++) {
    const lo = Math.max(0, Math.floor(edges[s]) + 1);
    const hi = Math.min(last, Math.floor(edges[s + 1]));
    if (hi < lo) continue;
    const n = prefix.count[hi + 1] - prefix.count[lo];
    const hr = n ? (prefix.sum[hi + 1] - prefix.sum[lo]) / n : null;
    points.push({ x: 100 * logX(head - (lo + hi) / 2, span), hr });
  }
  return points;
}
