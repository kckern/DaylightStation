// Series indexing (matches CycleRaceEngine ghost use, `[0, ...ghostSeries]`):
// series[i] is the distance in metres at (i + 1) * intervalS seconds.
const timeOf = (i, intervalS) => (i + 1) * intervalS;
const num = (n) => (Number.isFinite(n) ? n : 0);
const step = (s) => (Number.isFinite(s) && s > 0 ? s : 1);

/**
 * Rival's distance at time tS (linear between samples, clamped to the recording).
 * @param {number[]} series distance in metres per sample
 * @param {number} tS seconds
 * @param {number} [intervalS=1] seconds between samples
 * @returns {number} metres; 0 for a bad series or non-positive/NaN time
 */
export function distanceAtTime(series, tS, intervalS = 1) {
  if (!Array.isArray(series) || !series.length || !(tS > 0)) return 0;
  const iv = step(intervalS);
  let prevD = 0; let prevT = 0;
  for (let i = 0; i < series.length; i++) {
    const t = timeOf(i, iv);
    if (t >= tS) return prevD + ((tS - prevT) / (t - prevT)) * (series[i] - prevD);
    prevD = series[i]; prevT = t;
  }
  return prevD;
}

/**
 * When the rival FIRST reached distance d (a stopped stretch does not move this).
 * @param {number[]} series distance in metres per sample
 * @param {number} d metres
 * @param {number} [intervalS=1] seconds between samples
 * @returns {number|null} seconds; 0 for non-positive/NaN d; null for a bad series or if they never got that far
 */
export function timeAtDistance(series, d, intervalS = 1) {
  if (!Array.isArray(series) || !series.length) return null;
  if (!(d > 0)) return 0;
  const iv = step(intervalS);
  let prevD = 0; let prevT = 0;
  for (let i = 0; i < series.length; i++) {
    const t = timeOf(i, iv);
    if (series[i] >= d) {
      const span = series[i] - prevD;
      return span > 0 ? prevT + ((d - prevD) / span) * (t - prevT) : t;
    }
    prevD = series[i]; prevT = t;
  }
  return null;
}

/**
 * Rider versus a rival recording. Positive = rider ahead.
 * @param {{riderDistanceM?:number, elapsedS?:number, rivalSeries?:number[], intervalS?:number}} [args]
 * @returns {{gapM:number, gapS:number|null, ahead:boolean}|null} gapM metres (1 dp); gapS seconds sooner
 *   the rider reached this point (1 dp), null once past the end of the recording; null if no usable series
 */
export function paceDelta({ riderDistanceM = 0, elapsedS = 0, rivalSeries = [], intervalS = 1 } = {}) {
  if (!Array.isArray(rivalSeries) || !rivalSeries.length) return null;
  const round1 = (n) => Math.round(n * 10) / 10;
  const dist = num(riderDistanceM);
  const el = num(elapsedS);
  const gapM = round1(dist - distanceAtTime(rivalSeries, el, intervalS));
  const tRival = timeAtDistance(rivalSeries, dist, intervalS);
  return { gapM, gapS: tRival == null ? null : round1(tRival - el), ahead: gapM >= 0 };
}
