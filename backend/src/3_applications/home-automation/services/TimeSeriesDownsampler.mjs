/**
 * Downsample a time-series to at most `target` points by bucketed mean
 * (for numeric values) or first-in-bucket (for non-numeric).
 * @param {Array<{t:string,v:number|string}>} series
 * @param {number} target - desired max number of output points
 */
export function downsample(series, target) {
  if (!Array.isArray(series) || series.length === 0) return [];
  if (series.length <= target) return series;
  const bucketSize = Math.ceil(series.length / target);
  const out = [];
  for (let i = 0; i < series.length; i += bucketSize) {
    const bucket = series.slice(i, i + bucketSize);
    const numeric = bucket.every(p => typeof p.v === 'number');
    if (numeric) {
      const sum = bucket.reduce((s, p) => s + p.v, 0);
      out.push({ t: bucket[0].t, v: sum / bucket.length });
    } else {
      out.push({ t: bucket[0].t, v: bucket[0].v });
    }
  }
  return out;
}

export default { downsample };
