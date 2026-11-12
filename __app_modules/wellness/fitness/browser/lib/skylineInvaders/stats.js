// Small numeric helpers shared by the Skyline Invaders measurement modules.
// Pure: no DOM, no clocks.

export const round = (value, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

export const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Sample standard deviation (n - 1). Null below two values. */
export function stddev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

/** Percentile with linear interpolation between closest ranks. p in 0..100. */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** { n, mean, sd, min, max, p50, p95 }, rounded. All-null (n: 0) when empty. */
export function summarize(values, digits = 1) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return { n: 0, mean: null, sd: null, min: null, max: null, p50: null, p95: null };
  return {
    n: clean.length,
    mean: round(mean(clean), digits),
    sd: round(stddev(clean), digits),
    min: round(Math.min(...clean), digits),
    max: round(Math.max(...clean), digits),
    p50: round(percentile(clean, 50), digits),
    p95: round(percentile(clean, 95), digits),
  };
}

export const pct = (count, total) => (total > 0 ? round((100 * count) / total, 1) : null);
