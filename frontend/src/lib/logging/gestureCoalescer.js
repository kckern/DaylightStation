export function coalesce(samples, { frameMs = 16 } = {}) {
  if (!samples || samples.length === 0) return [];
  if (samples.length === 1) return [samples[0]];
  const out = [samples[0]];
  let windowStart = samples[0].t;
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].t - windowStart >= frameMs) { out.push(samples[i]); windowStart = samples[i].t; }
  }
  out.push(samples[samples.length - 1]);
  return out;
}
