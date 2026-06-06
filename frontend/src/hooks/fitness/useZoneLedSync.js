/**
 * useZoneLedSync - Ambient LED Zone Synchronization Hook
 *
 * Syncs participant heart rate zones with Home Assistant LED scenes
 * via the backend /fitness/zone_led endpoint.
 *
 * Features:
 * - Throttled updates (default 5s) to avoid spamming backend
 * - Debounced zone changes (1s) for stability
 * - Automatic session-end LED-off
 * - Graceful degradation on errors
 *
 * Mechanics (debounce/throttle/fire-and-forget POST, immediate session-end
 * payload, unmount beacon) are delegated to the shared useFitnessStateSync hook.
 */

import { useFitnessStateSync } from './useFitnessStateSync.js';
import { getLogger } from '../../lib/logging/Logger.js';

const THROTTLE_MS = 5000; // Minimum interval between LED updates
const DEBOUNCE_MS = 1000; // Wait for zone stability before sending

/**
 * Build a signature string for zone state comparison
 * @param {Array} roster - Participant roster with zoneId and isActive
 * @returns {string} Signature for comparison
 */
function buildZoneSignature(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return 'empty';

  const normalized = roster
    .filter(p => p && p.isActive !== false)
    .map(p => p.rawZoneId || p.zoneId || 'unknown')
    .sort()
    .join(',');

  return normalized || 'empty';
}

/**
 * Map a roster into the wire shape for the zone_led endpoint.
 */
function buildZones(roster) {
  return (Array.isArray(roster) ? roster : []).map(z => ({
    zoneId: z.rawZoneId || z.zoneId || null,
    isActive: z.isActive !== false
  }));
}

/**
 * Hook to sync participant zones with ambient LED scenes
 *
 * @param {Object} options
 * @param {Array} options.participantRoster - Array of {zoneId, isActive} objects
 * @param {boolean} options.sessionActive - Whether a fitness session is currently active
 * @param {boolean} options.enabled - Whether the feature is enabled (from config)
 * @param {string} options.householdId - Household ID for multi-household support
 */
export function useZoneLedSync({
  participantRoster = [],
  sessionActive = false,
  enabled = false,
  householdId = null
}) {
  useFitnessStateSync({
    endpoint: 'api/v1/fitness/zone_led',
    enabled,
    sessionActive,
    throttleMs: THROTTLE_MS,
    debounceMs: DEBOUNCE_MS,
    buildSignature: () => buildZoneSignature(participantRoster),
    buildPayload: () => {
      const zones = buildZones(participantRoster);
      // Log zone LED activation (sampled to reduce volume)
      const activeZones = zones.filter(z => z.isActive && z.zoneId);
      getLogger().sampled('fitness.zone_led.activated', {
        zoneCount: activeZones.length,
        zoneIds: activeZones.map(z => z.zoneId),
        sessionEnded: false,
        householdId
      }, { maxPerMinute: 20 });
      return {
        zones,
        sessionEnded: false,
        householdId,
        timestamp: Date.now()
      };
    },
    buildEndPayload: () => ({
      zones: [],
      sessionEnded: true,
      householdId,
      timestamp: Date.now()
    })
  });
}

export default useZoneLedSync;
