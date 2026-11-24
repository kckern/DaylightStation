import { committedZoneId } from '../../lib/committedZone.js';
/**
 * useZoneLedSync - Ambient LED Zone Synchronization Hook
 *
 * Syncs participant heart rate zones with Home Assistant LED scenes
 * via the backend /fitness/zone_led endpoint.
 *
 * Features:
 * - Sends each committed zone change within ~250ms (at most one POST a second)
 * - The zone store already debounces zones, and the backend adapter keeps its
 *   own minimum spacing between scene changes, applying a change that arrives
 *   too soon when the spacing ends
 * - Automatic session-end LED-off
 * - Graceful degradation on errors
 *
 * Mechanics (debounce/throttle/fire-and-forget POST, immediate session-end
 * payload, unmount beacon) are delegated to the shared useFitnessStateSync hook.
 */

import { useFitnessStateSync } from "./useFitnessStateSync.js";
import { getLogger } from "../../../../../../frontend/src/lib/logging/Logger.js";

// The lights trail the committed zone by at most THROTTLE_MS. They were 5000 / 1000:
// on 2026-11-23 Fire -> Hot committed at :30.1 and the strips changed at :32.1,
// because another rider's change had been sent 3.4s earlier.
const THROTTLE_MS = 1000; // Minimum interval between LED POSTs
const DEBOUNCE_MS = 250;  // Coalesce a render burst of zone changes into one POST

/**
 * Build a signature string for zone state comparison
 * @param {Array} roster - Participant roster with zoneId and isActive
 * @returns {string} Signature for comparison
 */
function buildZoneSignature(roster) {
  if (!Array.isArray(roster) || roster.length === 0) return 'empty';

  const normalized = roster
    .filter(p => p && p.isActive !== false)
    .map(p => committedZoneId(p) || 'unknown')
    .sort()
    .join(',');

  return normalized || 'empty';
}

/**
 * Map a roster into the wire shape for the zone_led endpoint.
 */
function buildZones(roster) {
  return (Array.isArray(roster) ? roster : []).map(z => ({
    zoneId: committedZoneId(z),
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
