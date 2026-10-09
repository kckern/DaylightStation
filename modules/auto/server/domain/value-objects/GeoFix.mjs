// backend/src/2_domains/automotive/value-objects/GeoFix.mjs

/**
 * One validated GNSS coordinate.
 *
 * ## Why (0,0) is refused rather than stored
 *
 * The in-car firmware emits `lat: 0, lon: 0` before it has a satellite lock —
 * not as an error, just as the initial value of the struct. Persisted verbatim
 * that reads as a perfectly plausible fix in the Gulf of Guinea, roughly 12,000
 * km from anywhere this household drives. It would anchor journey endpoints,
 * poison haversine distance, and plot a map line across the Atlantic.
 *
 * The ingest relay already drops it (`fixOrNull` in `automotiveRelay.mjs`), and
 * this refuses it again for the same reason: a value object that can be built
 * from history, from a config file, or from a request body cannot assume
 * whichever caller it got must have sanitised first.
 *
 * @module automotive/value-objects/GeoFix
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

/** Mean Earth radius, km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

export class GeoFix {
  #lat;
  #lon;

  /**
   * @param {object} props
   * @param {number} props.lat  degrees, -90..90
   * @param {number} props.lon  degrees, -180..180
   * @throws {ValidationError} on a non-finite, out-of-range, or null-island value
   */
  constructor({ lat, lon }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new ValidationError('GeoFix requires finite lat and lon', {
        code: 'INVALID_FIX', field: 'lat,lon', value: `${lat},${lon}`,
      });
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new ValidationError('GeoFix out of range', {
        code: 'FIX_OUT_OF_RANGE', field: 'lat,lon', value: `${lat},${lon}`,
      });
    }
    if (lat === 0 && lon === 0) {
      throw new ValidationError('GeoFix (0,0) is the pre-lock placeholder, not a position', {
        code: 'FIX_NULL_ISLAND', field: 'lat,lon', value: '0,0',
      });
    }
    this.#lat = lat;
    this.#lon = lon;
    Object.freeze(this);
  }

  get lat() { return this.#lat; }
  get lon() { return this.#lon; }

  /**
   * Build from untrusted input, yielding null instead of throwing.
   *
   * The sample stream is mostly-absent by design — a trip can be 30% unfixed —
   * so "no fix here" is the normal case and must not cost an exception per row.
   * Use the constructor where a fix is required, this where it is optional.
   *
   * @param {{lat: unknown, lon: unknown}|null|undefined} raw
   * @returns {GeoFix|null}
   */
  static fromRaw(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat);
    const lon = Number(raw.lon);
    try {
      return new GeoFix({ lat, lon });
    } catch {
      return null;
    }
  }

  /**
   * Great-circle distance to another fix, in km.
   * @param {GeoFix} other
   * @returns {number}
   */
  distanceKmTo(other) {
    const dLat = toRadians(other.lat - this.#lat);
    const dLon = toRadians(other.lon - this.#lon);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRadians(this.#lat)) * Math.cos(toRadians(other.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
  }

  /** @param {GeoFix} other */
  equals(other) {
    return other instanceof GeoFix && other.lat === this.#lat && other.lon === this.#lon;
  }

}
