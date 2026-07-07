/**
 * ZoneService - Heart rate zone resolution and management
 */

import {
  resolveZone,
  getHigherZone,
  createDefaultZones,
  getDefaultThresholds as domainGetDefaultThresholds,
  ZONE_PRIORITY,
  ZONE_COLORS,
} from '../entities/Zone.mjs';

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
   * Get default thresholds for a max heart rate.
   * Delegates to the domain SSOT (Zone.mjs) so these can never drift from the
   * Zone entity's default zones (audit X-5).
   */
  getDefaultThresholds(maxHr = 185) {
    return domainGetDefaultThresholds(maxHr);
  }

  /**
   * Create zones for display
   */
  createZonesForDisplay(maxHr = 185) {
    return createDefaultZones(maxHr);
  }

  /**
   * Get zone color from the canonical domain palette (Zone.mjs / ZoneName).
   */
  getZoneColor(zoneName) {
    return ZONE_COLORS[zoneName] || '#6B7280';
  }
}

export default ZoneService;
