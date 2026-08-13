// backend/src/2_domains/automotive/services/FuelEconomyService.mjs

/**
 * Fuel economy and spend, computed only where they are actually knowable.
 *
 * ## The full-to-full method, and why nothing else will do
 *
 * Economy is distance ÷ fuel burned. Distance is easy — two odometer readings.
 * Fuel burned is the hard half: the tank is a reservoir, so the volume pumped
 * on any given day is not the volume consumed since the last visit.
 *
 * Between two **full** tanks it is, though. The tank starts full and ends full,
 * so everything pumped in between was burned in between. That is the entire
 * basis of the calculation, and it is why a partial fill cannot close an
 * interval: it leaves an unknown amount in the tank, and the equation loses a
 * side.
 *
 * The volume attributed to an interval is every fill **after** the opening full
 * tank, up to and including the closing one. The opening fill's own volume
 * belongs to the previous interval — it is what made the tank full at the
 * start, not what was burned after.
 *
 * ## Two full tanks before anything can be said
 *
 * With zero or one qualifying fill-up there is no interval and therefore no
 * economy figure. The correct output is nothing, and the UI is expected to say
 * "needs another fill-up" rather than render a placeholder that looks like a
 * measurement.
 *
 * @module automotive/services/FuelEconomyService
 */

const KM_PER_MILE = 1.609344;
const LITRES_PER_GALLON = 3.785411784;

/**
 * Economy intervals between consecutive full tanks.
 *
 * @param {import('../entities/FuelLog.mjs').FuelLog[]} logs
 * @returns {Array<{from: Date, to: Date, distanceKm: number, volumeL: number, kmPerLitre: number, mpg: number, costTotal: number|null}>}
 */
export function computeEconomyIntervals(logs) {
  const ordered = [...(logs || [])].sort((a, b) => a.date - b.date);
  const intervals = [];

  let openIndex = ordered.findIndex((log) => log.canCloseInterval);
  if (openIndex === -1) return intervals;

  for (let i = openIndex + 1; i < ordered.length; i += 1) {
    if (!ordered[i].canCloseInterval) continue;

    const opening = ordered[openIndex];
    const closing = ordered[i];
    const distanceKm = closing.odometerKm - opening.odometerKm;

    // Everything pumped after the opening full tank, through the closing one.
    const burned = ordered.slice(openIndex + 1, i + 1);
    const volumeL = burned.reduce((sum, log) => sum + log.volumeL, 0);

    // A non-advancing or backwards odometer means a mistyped reading or a
    // replaced cluster. Skip the interval rather than emit a negative or
    // infinite economy figure, and re-open from here.
    if (distanceKm > 0 && volumeL > 0) {
      const costs = burned.map((log) => log.priceTotal).filter((c) => Number.isFinite(c));
      intervals.push({
        from: opening.date,
        to: closing.date,
        distanceKm: round(distanceKm, 1),
        volumeL: round(volumeL, 2),
        kmPerLitre: round(distanceKm / volumeL, 3),
        mpg: round((distanceKm / KM_PER_MILE) / (volumeL / LITRES_PER_GALLON), 2),
        costTotal: costs.length === burned.length ? round(costs.reduce((a, b) => a + b, 0), 2) : null,
      });
    }
    openIndex = i;
  }

  return intervals;
}

/**
 * Rolled-up economy and spend.
 *
 * The lifetime average is distance ÷ volume across all intervals, NOT the mean
 * of the per-interval figures. Averaging ratios over unequal distances
 * overweights short intervals — a 30-mile tank and a 400-mile tank would count
 * the same — and the answer drifts from the number that actually describes the
 * fuel bought.
 *
 * @param {import('../entities/FuelLog.mjs').FuelLog[]} logs
 * @returns {{
 *   intervals: Array<object>, avgMpg: number|null, bestMpg: number|null, worstMpg: number|null,
 *   totalSpend: number|null, totalVolumeL: number, fillCount: number, needsMoreData: boolean
 * }}
 */
export function summarizeFuel(logs) {
  const all = logs || [];
  const intervals = computeEconomyIntervals(all);

  const spends = all.map((log) => log.priceTotal).filter((c) => Number.isFinite(c));
  const totalSpend = spends.length ? round(spends.reduce((a, b) => a + b, 0), 2) : null;
  const totalVolumeL = round(all.reduce((sum, log) => sum + log.volumeL, 0), 2);

  if (!intervals.length) {
    return {
      intervals: [],
      avgMpg: null,
      bestMpg: null,
      worstMpg: null,
      totalSpend,
      totalVolumeL,
      fillCount: all.length,
      needsMoreData: true,
    };
  }

  const distanceKm = intervals.reduce((sum, i) => sum + i.distanceKm, 0);
  const volumeL = intervals.reduce((sum, i) => sum + i.volumeL, 0);
  const mpgs = intervals.map((i) => i.mpg);

  return {
    intervals,
    avgMpg: round((distanceKm / KM_PER_MILE) / (volumeL / LITRES_PER_GALLON), 2),
    bestMpg: Math.max(...mpgs),
    worstMpg: Math.min(...mpgs),
    totalSpend,
    totalVolumeL,
    fillCount: all.length,
    needsMoreData: false,
  };
}

const round = (n, places) => Number(n.toFixed(places));
