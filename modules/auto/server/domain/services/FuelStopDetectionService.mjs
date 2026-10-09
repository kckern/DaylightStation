// backend/src/2_domains/automotive/services/FuelStopDetectionService.mjs

/**
 * Spot fill-ups by watching the fuel gauge go UP.
 *
 * ## Why the gauge beats the map
 *
 * The obvious way to find a fill-up is to notice the car stopped at a gas
 * station. That is a proxy, and a poor one: it needs the station to already be
 * a named place, it fires for a stop at the attached convenience store, and it
 * cannot tell you that fuel was actually bought.
 *
 * The fuel level is the event itself. Tanks do not refill on their own, so a
 * meaningful rise IS a fill-up — no registry, no naming, no geography, and it
 * works at a station you will never visit again.
 *
 * Measured in the live tree 2026-08-12: readings of 43%, 43%, 40%, then 93%.
 * That 40 → 93 jump is a tank fill, and it was already sitting in history while
 * the place-based detector found nothing (nothing had been named yet).
 *
 * ## Sparse readings are enough
 *
 * Detection needs two readings that BRACKET the fill, not continuous coverage.
 * That matters here because the engine bus answers intermittently — the trips
 * above carried only 2–3 fuel readings each across ~200 samples. A detector
 * requiring a clean series would find nothing; this one only needs before and
 * after.
 *
 * ## The rise happens BETWEEN trips, not inside one
 *
 * Refuelling happens with the engine off, so the device is asleep or unpowered
 * while the tank fills. The signal is therefore the last known level of one trip
 * against the first known level of the next. Comparing within a trip would never
 * see it.
 *
 * @module automotive/services/FuelStopDetectionService
 */

/**
 * Minimum rise, in percentage points, that counts as a fill-up.
 *
 * Fuel-level senders are non-linear and slosh: the float moves with cornering,
 * with gradient, and with how level the car is parked, so small apparent rises
 * are noise rather than fuel. Ten points is comfortably above that and still
 * well below any fill worth logging — a splash-and-dash on a 19-gallon tank is
 * still ~2 gallons.
 */
export const DEFAULT_MIN_RISE_PCT = 10;

/**
 * @typedef {object} FuelReading
 * @property {number} pct    0-100
 * @property {Date} at
 * @property {string} [tripId]
 */

/**
 * @typedef {object} DetectedFillUp
 * @property {Date} at                 best estimate — when fuel was first seen higher
 * @property {Date} notBefore          last reading at the lower level
 * @property {number} fromPct
 * @property {number} toPct
 * @property {number} risePct
 * @property {number|null} estimatedVolumeL
 * @property {boolean} filledToFull    ended near the top of the tank
 */

/**
 * Find fill-ups in a chronological series of fuel readings.
 *
 * @param {FuelReading[]} readings
 * @param {object} [options]
 * @param {number} [options.minRisePct]
 * @param {number} [options.tankCapacityL] enables the volume estimate
 * @returns {DetectedFillUp[]} newest first
 */
export function detectFillUps(readings, { minRisePct = DEFAULT_MIN_RISE_PCT, tankCapacityL = null } = {}) {
  const series = (readings || [])
    .filter((r) => Number.isFinite(r?.pct) && r.pct >= 0 && r.pct <= 100 && r.at instanceof Date)
    .sort((a, b) => a.at - b.at);

  const found = [];
  for (let i = 1; i < series.length; i += 1) {
    const before = series[i - 1];
    const after = series[i];
    const risePct = after.pct - before.pct;
    if (risePct < minRisePct) continue;

    // The tank cannot gain fuel on its own, so this is a fill. The exact moment
    // is unknowable — it happened somewhere in the gap while the device was off
    // — so both bounds are reported rather than a false-precision midpoint.
    found.push({
      at: after.at,
      notBefore: before.at,
      fromPct: before.pct,
      toPct: after.pct,
      risePct: round(risePct, 1),
      estimatedVolumeL: Number.isFinite(tankCapacityL) && tankCapacityL > 0
        ? round((risePct / 100) * tankCapacityL, 2)
        : null,
      // A gauge reading near the top means the tank was filled rather than
      // splashed — which is what decides whether it can close an mpg interval.
      filledToFull: after.pct >= 90,
      beforeTripId: before.tripId || null,
      afterTripId: after.tripId || null,
    });
  }

  return found.reverse();
}

/**
 * Detected fill-ups with no matching logged entry.
 *
 * Matching is by date with a tolerance either side, because the detected
 * timestamp is the first reading AFTER the fill, which can land a day later
 * than the pump receipt — the device may not wake until the next drive.
 * Prompting about a fill-up already recorded is the failure mode that would
 * make this feature obnoxious, so it errs toward staying quiet.
 *
 * @param {DetectedFillUp[]} detected
 * @param {Array<{date: Date}>} loggedFills
 * @param {number} [toleranceDays]
 * @returns {DetectedFillUp[]}
 */
export function unloggedFillUps(detected, loggedFills, toleranceDays = 2) {
  const logged = (loggedFills || []).map((log) => log.date).filter((d) => d instanceof Date);
  return (detected || []).filter((fill) => !logged.some((when) =>
    // Anywhere between the two bounds, plus the tolerance, counts as the same event.
    when >= addDays(fill.notBefore, -toleranceDays) && when <= addDays(fill.at, toleranceDays)));
}

const addDays = (date, days) => new Date(date.getTime() + days * 86400000);
const round = (n, places) => Number(n.toFixed(places));
