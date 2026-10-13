/** Round a positive range to a "nice" magnitude (1/2/5 × 10^n). */
export function niceNum(range, round) {
  if (!(range > 0)) return 0;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nf;
  if (round) {
    if (frac < 1.5) nf = 1; else if (frac < 3) nf = 2; else if (frac < 7) nf = 5; else nf = 10;
  } else {
    if (frac <= 1) nf = 1; else if (frac <= 2) nf = 2; else if (frac <= 5) nf = 5; else nf = 10;
  }
  return nf * Math.pow(10, exp);
}

/**
 * Human-friendly axis ticks spanning [min,max] with ~desiredCount steps.
 * Replaces FitnessChart's `value.toFixed(0)` over a warped domain, which produced
 * nonsense ticks like 42/172/303/433 (audit Sin 3).
 */
export function niceTicks(min, max, desiredCount = 5) {
  if (!(max > min)) return [Math.round(min) || 0];
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, desiredCount - 1), true) || 1;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}
