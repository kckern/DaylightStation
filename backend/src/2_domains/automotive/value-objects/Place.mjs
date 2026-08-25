// backend/src/2_domains/automotive/value-objects/Place.mjs

/**
 * A named location the household actually goes to — home, school, the usual
 * gas station — as a centre plus a match radius.
 *
 * ## Why a radius rather than a polygon
 *
 * A parking lot is not a point, and the GNSS fix under a car's dashboard is not
 * precise. A radius absorbs both with one number a person can reason about and
 * edit by hand in YAML. Polygons would be more faithful and immeasurably more
 * annoying to maintain for a household that just wants "this is Costco".
 *
 * ## `kind` carries behaviour, not decoration
 *
 * `kind: 'fuel'` is what makes fill-up detection fall out of journey stitching
 * for free: a stop inside a fuel-kind place is a visit to a gas station, with no
 * fuel-level PID required and no reverse geocoding. The other kinds are
 * currently presentational, but the field is the seam where that changes.
 *
 * @module automotive/value-objects/Place
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { GeoFix } from './GeoFix.mjs';

/**
 * Recognised place kinds. `fuel` drives fill-up detection; the rest group and
 * label. Unknown kinds are rejected rather than passed through, so a typo in
 * `places.yml` surfaces at load instead of silently disabling detection.
 */
export const PLACE_KINDS = Object.freeze([
  'home', 'school', 'church', 'work', 'fuel', 'store', 'service', 'other',
]);

/** Radius used when a place omits one — generous enough for a parking lot. */
export const DEFAULT_RADIUS_M = 120;

export class Place {
  #id;
  #label;
  #fix;
  #radiusM;
  #kind;

  /**
   * @param {object} props
   * @param {string} props.id
   * @param {string} props.label
   * @param {GeoFix} props.fix
   * @param {number} [props.radiusM]
   * @param {string} [props.kind]
   */
  constructor({ id, label, fix, radiusM = DEFAULT_RADIUS_M, kind = 'other' }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Place requires an id', { code: 'PLACE_ID_REQUIRED', field: 'id', value: id });
    }
    if (!(fix instanceof GeoFix)) {
      throw new ValidationError('Place requires a GeoFix', { code: 'PLACE_FIX_REQUIRED', field: 'fix', value: fix });
    }
    if (!Number.isFinite(radiusM) || radiusM <= 0) {
      throw new ValidationError('Place radius must be a positive number of metres', {
        code: 'PLACE_RADIUS_INVALID', field: 'radiusM', value: radiusM,
      });
    }
    if (!PLACE_KINDS.includes(kind)) {
      throw new ValidationError(`Place kind must be one of: ${PLACE_KINDS.join(', ')}`, {
        code: 'PLACE_KIND_INVALID', field: 'kind', value: kind,
      });
    }
    this.#id = id;
    this.#label = label || id;
    this.#fix = fix;
    this.#radiusM = radiusM;
    this.#kind = kind;
    Object.freeze(this);
  }

  get id() { return this.#id; }
  get label() { return this.#label; }
  get fix() { return this.#fix; }
  get radiusM() { return this.#radiusM; }
  get kind() { return this.#kind; }

  /** Is this a place where fuel is bought? Drives fill-up detection. */
  get isFuelStop() { return this.#kind === 'fuel'; }

  /**
   * Does a fix fall inside this place?
   * @param {GeoFix} fix
   * @returns {boolean}
   */
  contains(fix) {
    if (!(fix instanceof GeoFix)) return false;
    return this.distanceMTo(fix) <= this.#radiusM;
  }

  /**
   * Metres from this place's centre to a fix. Exposed because the resolver
   * needs to rank overlapping places by proximity, not merely test membership.
   * @param {GeoFix} fix
   * @returns {number}
   */
  distanceMTo(fix) {
    return this.#fix.distanceKmTo(fix) * 1000;
  }

}
