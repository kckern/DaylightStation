// The pace rival's whole recording as chart samples. Pure, no DOM.
//
// Series indexing matches the engine's ghost replay: series[i] is the rival's
// distance in metres at (i + 1) × intervalS seconds, with an implicit 0 m at 0 s.

/**
 * Samples of the rival's recorded line, clipped to the chart's time window and
 * (in a distance race) ended at the goal line at the moment the rival crossed it.
 * @param {number[]} series recorded distances (metres)
 * @param {number} intervalS seconds between samples
 * @param {{windowS:number, goalM?:number|null, maxPoints?:number}} opts
 * @returns {{t:number, d:number}[]} from {t:0,d:0}; [] for a bad series or window
 */
export function rivalTraceSamples(series, intervalS, { windowS, goalM = null, maxPoints = 600 } = {}) {
  if (!Array.isArray(series) || !series.length || !(windowS > 0)) return [];
  const iv = Number.isFinite(intervalS) && intervalS > 0 ? intervalS : 1;
  const goal = Number.isFinite(goalM) && goalM > 0 ? goalM : null;
  const out = [{ t: 0, d: 0 }];
  let prev = out[0];
  for (let i = 0; i < series.length; i += 1) {
    const cur = { t: (i + 1) * iv, d: Number(series[i]) || 0 };
    if (goal != null && cur.d >= goal) {
      const span = cur.d - prev.d;
      const t = span > 0 ? prev.t + ((goal - prev.d) / span) * (cur.t - prev.t) : cur.t;
      if (t <= windowS) { out.push({ t, d: goal }); return decimate(out, maxPoints); }
    }
    if (cur.t > windowS) {
      const d = prev.d + ((windowS - prev.t) / (cur.t - prev.t)) * (cur.d - prev.d);
      out.push({ t: windowS, d });
      return decimate(out, maxPoints);
    }
    out.push(cur);
    prev = cur;
  }
  return decimate(out, maxPoints);
}

// Keep every k-th sample and always the last, so the line keeps both ends.
function decimate(samples, maxPoints) {
  const max = Number.isFinite(maxPoints) && maxPoints > 1 ? maxPoints : 600;
  if (samples.length <= max) return samples;
  const stride = Math.ceil(samples.length / max);
  const out = samples.filter((_, i) => i % stride === 0);
  const last = samples[samples.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export default rivalTraceSamples;
