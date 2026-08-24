// backend/src/2_domains/automotive/value-objects/OdometerReading.mjs

/**
 * A mileage value bound to where it came from.
 *
 * ## Why provenance is part of the value
 *
 * The four sources differ by more than an error bar — they differ in what they
 * even claim:
 *
 * | source | claim | typical error |
 * |---|---|---|
 * | `dash` | the number on the instrument cluster | none; it IS the odometer |
 * | `pid_31` | accumulated from the ECU's distance-since-cleared counter | small, wheel-derived |
 * | `speed_integration` | 1 Hz vehicle speed integrated over a trip | a few %, quantisation |
 * | `gps` | haversine over satellite fixes | undercounts; misses unfixed spans |
 *
 * A reading that forgets its source invites the worst bug available here:
 * displaying a GPS estimate as though someone had read it off the dash, and
 * then anchoring future arithmetic to it. Every reading therefore carries its
 * origin, and the UI is required to show it.
 *
 * Kilometres are the storage unit throughout — the device reports km, history
 * stores km, and conversion happens once, at the presentation edge.
 *
 * @module automotive/value-objects/OdometerReading
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Ordered most to least authoritative. */
export const ODOMETER_SOURCES = Object.freeze(['dash', 'pid_a6', 'pid_31', 'speed_integration', 'gps']);

/** Sources that can serve as an anchor for accumulation. Only a real dash reading qualifies. */
const ANCHOR_SOURCES = Object.freeze(['dash']);

export class OdometerReading {
  #km;
  #source;
  #observedAt;

  /**
   * @param {object} props
   * @param {number} props.km
   * @param {string} props.source     one of ODOMETER_SOURCES
   * @param {Date}   props.observedAt
   */
  constructor({ km, source, observedAt }) {
    if (!Number.isFinite(km) || km < 0) {
      throw new ValidationError('OdometerReading km must be a non-negative number', {
        code: 'ODOMETER_KM_INVALID', field: 'km', value: km,
      });
    }
    if (!ODOMETER_SOURCES.includes(source)) {
      throw new ValidationError(`OdometerReading source must be one of: ${ODOMETER_SOURCES.join(', ')}`, {
        code: 'ODOMETER_SOURCE_INVALID', field: 'source', value: source,
      });
    }
    if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
      throw new ValidationError('OdometerReading requires a valid observedAt Date', {
        code: 'ODOMETER_OBSERVED_AT_INVALID', field: 'observedAt', value: observedAt,
      });
    }
    this.#km = km;
    this.#source = source;
    this.#observedAt = new Date(observedAt.getTime()); // defensive copy: Date is mutable
    Object.freeze(this);
  }

  get km() { return this.#km; }
  get source() { return this.#source; }
  get observedAt() { return new Date(this.#observedAt.getTime()); }

  /** Can this reading anchor an accumulation? Only a dash reading can. */
  get isAnchor() { return ANCHOR_SOURCES.includes(this.#source); }

  /** Is this an estimate rather than an observation? Drives the UI's hedging. */
  get isEstimate() { return this.#source !== 'dash'; }

  toJSON() {
    return { km: this.#km, source: this.#source, observed_at: this.#observedAt.toISOString() };
  }
}
