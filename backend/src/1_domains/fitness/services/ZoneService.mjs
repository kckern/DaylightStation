/**
 * ZoneService - Heart rate zone resolution and management
 */

import { resolveZone, getHigherZone, createDefaultZones, ZONE_PRIORITY } from '../entities/Zone.mjs';

export class ZoneService {
  constructor({ zoneConfig = null } = {}) {
    this.zoneConfig = zoneConfig;
  }

  /**
   * Resolve zone for a heart rate
   * @param {number} hr - Heart rate
   * @param {Object} [thresholds] - Custom thresholds
   */
  resolveZone(hr, thresholds = null) {
    const config = thresholds || this.zoneConfig || this.getDefaultThresholds();
    return resolveZone(hr, config);
  }

  /**
   * Get group zone (highest zone among all participants)
   * @param {Object} heartRates - Map of participant name to heart rate
   * @param {Object} [thresholds] - Custom thresholds
   */
  getGroupZone(heartRates, thresholds = null) {
    const zones = Object.values(heartRates)
      .filter(hr => hr > 0)
      .map(hr => this.resolveZone(hr, thresholds));

    if (zones.length === 0) return 'cool';

    return zones.reduce((highest, zone) => getHigherZone(highest, zone), 'cool');
  }

  /**
   * Get zone priority
   */
  getZonePriority(zoneName) {
    return ZONE_PRIORITY[zoneName] ?? 0;
  }

  /**
   * Compare two zones
   */
  compareZones(zone1, zone2) {
    const p1 = this.getZonePriority(zone1);
    const p2 = this.getZonePriority(zone2);
    return p1 - p2;
  }

  /**
   * Get default thresholds for a max heart rate
   */
  getDefaultThresholds(maxHr = 185) {
    return {
      cool: Math.round(maxHr * 0.5),
      active: Math.round(maxHr * 0.6),
      warm: Math.round(maxHr * 0.7),
      hot: Math.round(maxHr * 0.8),
      fire: Math.round(maxHr * 0.9)
    };
  }

  /**
   * Create zones for display
   */
  createZonesForDisplay(maxHr = 185) {
    return createDefaultZones(maxHr);
  }

  /**
   * Get zone color
   */
  getZoneColor(zoneName) {
    const colors = {
      cool: '#3B82F6',    // blue
      active: '#10B981',  // green
      warm: '#F59E0B',    // yellow
      hot: '#F97316',     // orange
      fire: '#EF4444'     // red
    };
    return colors[zoneName] || '#6B7280';
  }
}

export default ZoneService;
