/**
 * Zone Entity - Represents heart rate zones
 *
 * Zones: cool < active < warm < hot < fire
 */

import { ValidationError } from '../../core/errors/index.mjs';

export const ZONE_NAMES = ['cool', 'active', 'warm', 'hot', 'fire'];

export const ZONE_PRIORITY = {
  cool: 0,
  active: 1,
  warm: 2,
  hot: 3,
  fire: 4
};

export class Zone {
  constructor({
    name,
    minHr,
    maxHr,
    color = null
  }) {
    if (!ZONE_NAMES.includes(name)) {
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
    return ZONE_PRIORITY[this.name];
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
 * Create default zones from max heart rate
 */
export function createDefaultZones(maxHr) {
  return {
    cool: new Zone({ name: 'cool', minHr: 0, maxHr: Math.round(maxHr * 0.5) }),
    active: new Zone({ name: 'active', minHr: Math.round(maxHr * 0.5), maxHr: Math.round(maxHr * 0.6) }),
    warm: new Zone({ name: 'warm', minHr: Math.round(maxHr * 0.6), maxHr: Math.round(maxHr * 0.7) }),
    hot: new Zone({ name: 'hot', minHr: Math.round(maxHr * 0.7), maxHr: Math.round(maxHr * 0.85) }),
    fire: new Zone({ name: 'fire', minHr: Math.round(maxHr * 0.85), maxHr: 999 })
  };
}

export default Zone;
