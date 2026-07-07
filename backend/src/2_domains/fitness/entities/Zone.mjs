/**
 * Zone Entity - Represents heart rate zones
 *
 * Zones: cool < active < warm < hot < fire
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import {
  ZONE_NAMES as _ZONE_NAMES,
  ZONE_PRIORITY as _ZONE_PRIORITY,
  ZONE_COLORS as _ZONE_COLORS,
  isValidZoneName,
  zonePriority,
} from '../value-objects/ZoneName.mjs';

// Re-export for backward compatibility. Zone.mjs is the single import point for
// the fitness zone SSOT: order, default thresholds, and canonical colors.
export const ZONE_NAMES = _ZONE_NAMES;
export const ZONE_PRIORITY = _ZONE_PRIORITY;
export const ZONE_COLORS = _ZONE_COLORS;

/**
 * Canonical zone order (cool → fire). This is the ONE ordered zone list; adapters
 * and renderers import it instead of re-declaring a local literal.
 * @type {readonly string[]}
 */
export const ZONE_ORDER = ZONE_NAMES;

/**
 * Canonical default zone lower-bound fractions of max heart rate — the single
 * source of truth for default zone boundaries. Both getDefaultThresholds (the
 * threshold-map view) and createDefaultZones (the Zone-object view) derive from
 * this, so they can never diverge again (audit X-5).
 * @type {Object.<string, number>}
 */
export const DEFAULT_ZONE_FRACTIONS = Object.freeze({
  cool: 0,
  active: 0.5,
  warm: 0.6,
  hot: 0.7,
  fire: 0.85,
});

export class Zone {
  constructor({
    name,
    minHr,
    maxHr,
    color = null
  }) {
    if (!isValidZoneName(name)) {
      throw new ValidationError(`Invalid zone name: ${name}. Must be one of: ${ZONE_NAMES.join(', ')}`, {
        code: 'INVALID_ZONE_NAME',
        field: 'name',
        value: name
      });
    }
    this.name = name;
    this.minHr = minHr;
    this.maxHr = maxHr;
    this.color = color;
  }

  /**
   * Get zone priority (higher = more intense)
   */
  getPriority() {
    return zonePriority(this.name);
  }

  /**
   * Check if a heart rate falls within this zone
   */
  containsHeartRate(hr) {
    return hr >= this.minHr && hr < this.maxHr;
  }

  /**
   * Compare zones by priority
   */
  isHigherThan(otherZone) {
    return this.getPriority() > otherZone.getPriority();
  }

  isLowerThan(otherZone) {
    return this.getPriority() < otherZone.getPriority();
  }

  /**
   * Serialize to plain object
   */
  toJSON() {
    return {
      name: this.name,
      minHr: this.minHr,
      maxHr: this.maxHr,
      color: this.color
    };
  }

  /**
   * Create from plain object
   */
  static fromJSON(data) {
    return new Zone(data);
  }
}

/**
 * Resolve zone for a heart rate value given zone thresholds
 * @param {number} hr - Heart rate
 * @param {Object} thresholds - Zone thresholds { cool, active, warm, hot, fire }
 * @returns {string} Zone name
 */
export function resolveZone(hr, thresholds) {
  if (hr < thresholds.cool) return 'cool';
  if (hr < thresholds.active) return 'cool';
  if (hr < thresholds.warm) return 'active';
  if (hr < thresholds.hot) return 'warm';
  if (hr < thresholds.fire) return 'hot';
  return 'fire';
}

/**
 * Get higher priority zone
 */
export function getHigherZone(zone1, zone2) {
  return ZONE_PRIORITY[zone1] >= ZONE_PRIORITY[zone2] ? zone1 : zone2;
}

/**
 * Default zone thresholds (lower bound HR where each zone begins) for a max HR.
 * Threshold-map view of DEFAULT_ZONE_FRACTIONS, consumed by resolveZone. Because
 * `resolveZone` treats each value as the HR at which that zone starts, the cool
 * threshold is 0 (cool spans from rest up to the active boundary).
 * @param {number} [maxHr=185]
 * @returns {{cool:number, active:number, warm:number, hot:number, fire:number}}
 */
export function getDefaultThresholds(maxHr = 185) {
  const thresholds = {};
  for (const name of ZONE_ORDER) {
    thresholds[name] = Math.round(maxHr * DEFAULT_ZONE_FRACTIONS[name]);
  }
  return thresholds;
}

/**
 * Create default zones from max heart rate. Zone-object view of the SAME
 * thresholds as getDefaultThresholds — each zone spans [its threshold, next
 * threshold) — so the two can never disagree (audit X-5).
 */
export function createDefaultZones(maxHr) {
  const t = getDefaultThresholds(maxHr);
  return {
    cool: new Zone({ name: 'cool', minHr: t.cool, maxHr: t.active, color: ZONE_COLORS.cool }),
    active: new Zone({ name: 'active', minHr: t.active, maxHr: t.warm, color: ZONE_COLORS.active }),
    warm: new Zone({ name: 'warm', minHr: t.warm, maxHr: t.hot, color: ZONE_COLORS.warm }),
    hot: new Zone({ name: 'hot', minHr: t.hot, maxHr: t.fire, color: ZONE_COLORS.hot }),
    fire: new Zone({ name: 'fire', minHr: t.fire, maxHr: 999, color: ZONE_COLORS.fire })
  };
}

export default Zone;
