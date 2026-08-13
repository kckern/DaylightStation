// backend/src/2_domains/automotive/services/OdometerService.mjs

/**
 * Turn what the car reports into a mileage figure, without ever inventing one.
 *
 * ## The source ladder
 *
 * 1. **A dash reading** (`source: 'dash'`) is the truth, and the only thing that
 *    can anchor an accumulation. It arrives as a side effect of logging a
 *    fill-up or a service visit — the moments you are already standing at the
 *    car with the number in front of you.
 * 2. **OBD PID 0x31**, "distance travelled since codes cleared", accumulates
 *    between anchors. It is wheel-derived, so unlike GPS it neither undercounts
 *    nor loses the span at the start of a drive that the device sleeps through.
 * 3. **Speed integration** covers trips where 0x31 did not answer but the ECU
 *    was up: the 1 Hz speed samples are already persisted per trip.
 * 4. **GPS haversine** is the floor, and is labelled as such.
 *
 * With no ECU link at all, dash readings alone still produce mileage and fuel
 * economy — the same model a manual-entry app uses. The ECU improves resolution
 * between fill-ups; it is not a precondition for the feature existing.
 *
 * ## 0x31 is a delta source, never an absolute odometer
 *
 * Two failure modes, both real, both handled explicitly rather than absorbed:
 *
 * - **It is 16-bit and wraps at 65,536 km.**
 * - **It resets to zero when DTCs are cleared** — which a shop does routinely
 *   after a repair, so this is an expected event, not a fault.
 *
 * Both present as "the counter went down". Guessing wrong in either direction
 * is bad: reading a reset as a rollover silently adds ~65,000 km, and reading a
 * rollover as a reset throws away real distance. They are separated by a
 * plausibility window (see `ROLLOVER_MARGIN_KM`), and where the answer is a
 * reset the span is recorded as **unmeasured** rather than estimated — the
 * distance driven between a shop clearing the codes and the next reading is
 * genuinely unknown, and the honest output is a gap.
 *
 * @module automotive/services/OdometerService
 */

import { OdometerReading } from '../value-objects/OdometerReading.mjs';

/** PID 0x31 is two bytes of kilometres, so it wraps here. */
export const COUNTER_MODULUS_KM = 65536;

/**
 * How close to each end of the counter's range a decrease must sit to read as a
 * rollover rather than a DTC-clear reset.
 *
 * A rollover can only happen from near the top of the range to near the bottom.
 * A reset can happen from anywhere. So: previous reading within this margin of
 * the modulus AND next reading within this margin of zero means rollover;
 * anything else is a reset.
 *
 * 2,000 km is deliberately generous — it is roughly a month of heavy driving,
 * far more than the gap between two readings in practice. The one case it gets
 * wrong is a code-clear that happens to occur above 63,536 km on the counter,
 * which is misread as a rollover; the resulting error is bounded by this margin
 * rather than by the modulus.
 */
export const ROLLOVER_MARGIN_KM = 2000;

/**
 * Accumulate distance across a chronological series of 0x31 counter readings.
 *
 * @param {Array<{km: number, at: Date}>} readings  ordered oldest to newest
 * @param {object} [options]
 * @param {number} [options.modulusKm]
 * @param {number} [options.rolloverMarginKm]
 * @returns {{distanceKm: number, unmeasuredSpans: Array<{from: Date, to: Date, reason: string}>, rollovers: number}}
 */
export function accumulateCounter(readings, {
  modulusKm = COUNTER_MODULUS_KM,
  rolloverMarginKm = ROLLOVER_MARGIN_KM,
} = {}) {
  const series = (readings || []).filter((r) => Number.isFinite(r?.km) && r.at instanceof Date);
  const unmeasuredSpans = [];
  let distanceKm = 0;
  let rollovers = 0;

  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const next = series[i];

    if (next.km >= prev.km) {
      distanceKm += next.km - prev.km;
      continue;
    }

    // The counter went down. Rollover or reset?
    const nearTop = prev.km >= modulusKm - rolloverMarginKm;
    const nearBottom = next.km <= rolloverMarginKm;
    if (nearTop && nearBottom) {
      distanceKm += (modulusKm - prev.km) + next.km;
      rollovers += 1;
      continue;
    }

    // A reset. The distance driven across this span is unknowable — the counter
    // that measured it was zeroed. Record the hole; do not estimate into it.
    unmeasuredSpans.push({ from: prev.at, to: next.at, reason: 'counter-reset' });
  }

  return { distanceKm, unmeasuredSpans, rollovers };
}

/**
 * Integrate 1 Hz vehicle speed over a trip's samples.
 *
 * Trapezoidal, and intervals where either endpoint lacks a speed reading are
 * **skipped rather than interpolated** — the bus drops in and out mid-trip, and
 * assuming the car held its last known speed through a 40-second gap in the
 * session is exactly the kind of confident fabrication this domain avoids. The
 * result therefore undercounts when the session is patchy, which is the safe
 * direction and is why this sits below 0x31 on the ladder.
 *
 * @param {Array<{t: number, speed_kph?: number}>} samples  `t` in seconds from trip start
 * @returns {number} km
 */
export function integrateSpeedKm(samples) {
  const rows = samples || [];
  let km = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const next = rows[i];
    if (!Number.isFinite(prev?.speed_kph) || !Number.isFinite(next?.speed_kph)) continue;
    const dtHours = (Number(next.t) - Number(prev.t)) / 3600;
    if (!Number.isFinite(dtHours) || dtHours <= 0) continue;
    km += ((prev.speed_kph + next.speed_kph) / 2) * dtHours;
  }
  return km;
}

/**
 * Best current mileage estimate, with its provenance and its holes.
 *
 * @param {object} input
 * @param {OdometerReading[]} input.anchors          dash readings, any order
 * @param {Array<{km: number, at: Date}>} [input.counterReadings]  0x31 series, ordered
 * @param {number} [input.fallbackDistanceKm]        distance since the anchor from
 *                                                   speed integration or GPS
 * @param {string} [input.fallbackSource]            'speed_integration' | 'gps'
 * @param {Date}   [input.at]                        as-of time for the estimate
 * @returns {{
 *   km: number|null,
 *   source: string|null,
 *   confidence: 'exact'|'estimated'|'degraded'|'unknown',
 *   anchor: OdometerReading|null,
 *   accumulatedKm: number,
 *   unmeasuredSpans: Array<{from: Date, to: Date, reason: string}>
 * }}
 */
export function estimateOdometer({
  anchors = [],
  counterReadings = [],
  fallbackDistanceKm = null,
  fallbackSource = 'gps',
  at = null,
} = {}) {
  const asOf = at instanceof Date ? at : null;
  const usable = anchors
    .filter((a) => a instanceof OdometerReading && a.isAnchor)
    .filter((a) => !asOf || a.observedAt <= asOf)
    .sort((a, b) => a.observedAt - b.observedAt);

  const anchor = usable.length ? usable[usable.length - 1] : null;

  // No dash reading has ever been entered. There is no basis for an absolute
  // number, and manufacturing one from trip distances alone would be a lie with
  // a plausible shape. Say so instead.
  if (!anchor) {
    return {
      km: null,
      source: null,
      confidence: 'unknown',
      anchor: null,
      accumulatedKm: 0,
      unmeasuredSpans: [],
    };
  }

  // Only counter readings AFTER the anchor contribute — anything earlier is
  // already baked into the dash number the anchor carries.
  const since = (counterReadings || [])
    .filter((r) => Number.isFinite(r?.km) && r.at instanceof Date)
    .filter((r) => r.at >= anchor.observedAt && (!asOf || r.at <= asOf))
    .sort((a, b) => a.at - b.at);

  if (since.length >= 2) {
    const { distanceKm, unmeasuredSpans } = accumulateCounter(since);
    return {
      km: round(anchor.km + distanceKm, 1),
      source: 'pid_31',
      confidence: unmeasuredSpans.length ? 'degraded' : 'estimated',
      anchor,
      accumulatedKm: round(distanceKm, 1),
      unmeasuredSpans,
    };
  }

  if (Number.isFinite(fallbackDistanceKm) && fallbackDistanceKm > 0) {
    return {
      km: round(anchor.km + fallbackDistanceKm, 1),
      source: fallbackSource,
      confidence: 'estimated',
      anchor,
      accumulatedKm: round(fallbackDistanceKm, 1),
      unmeasuredSpans: [],
    };
  }

  // Nothing has been driven since the anchor, or nothing was measured. Either
  // way the anchor itself is the answer, and it is exact.
  return {
    km: anchor.km,
    source: 'dash',
    confidence: 'exact',
    anchor,
    accumulatedKm: 0,
    unmeasuredSpans: [],
  };
}

const round = (n, places) => Number(n.toFixed(places));
